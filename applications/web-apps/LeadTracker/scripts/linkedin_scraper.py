import asyncio
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from supabase import Client, create_client

COOKIE_FILE = Path(os.environ.get("LINKEDIN_COOKIE_FILE", ".cache/linkedin_session.json"))
HEADLESS = os.environ.get("LINKEDIN_HEADLESS", "true").lower() != "false"
BOOTSTRAP_SESSION_ONLY = os.environ.get("LINKEDIN_BOOTSTRAP_SESSION_ONLY", "false").lower() == "true"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_local() -> date:
    return datetime.now().date()


def get_supabase() -> Client:
    return create_client(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


async def save_cookies(context, path: Path) -> None:
    ensure_parent_dir(path)
    cookies = await context.cookies()
    path.write_text(json.dumps(cookies), encoding="utf-8")
    print(f"[+] Session cookies saved to {path}")


async def load_cookies(context, path: Path) -> bool:
    if not path.exists():
        return False
    cookies = json.loads(path.read_text(encoding="utf-8"))
    await context.add_cookies(cookies)
    print(f"[+] Loaded session cookies from {path}")
    return True


async def wait_for_post_login(page) -> None:
    await page.wait_for_load_state("domcontentloaded")
    try:
        await page.wait_for_url("**linkedin.com/**", timeout=20000)
    except PlaywrightTimeoutError:
        pass

    if "checkpoint" in page.url or "challenge" in page.url:
        raise RuntimeError(
            "LinkedIn asked for a security challenge. Complete one successful login locally "
            "and refresh the saved session cookie before relying on the workflow."
        )

    if "login" in page.url:
        raise RuntimeError("LinkedIn login did not complete successfully.")


async def login_linkedin(page, context) -> None:
    print("[*] Logging into LinkedIn...")
    linkedin_email = require_env("LINKEDIN_EMAIL")
    linkedin_password = require_env("LINKEDIN_PASSWORD")
    await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
    await page.locator("#username").fill(linkedin_email)
    await page.locator("#password").fill(linkedin_password)
    await page.locator('[type="submit"]').click()
    await wait_for_post_login(page)
    print("[+] Login successful")
    await save_cookies(context, COOKIE_FILE)


async def ensure_linkedin_session(page, context) -> None:
    cookie_loaded = await load_cookies(context, COOKIE_FILE)
    await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")

    if cookie_loaded and "login" not in page.url and "checkpoint" not in page.url and "challenge" not in page.url:
        print("[+] Existing LinkedIn session is still valid")
        return

    if cookie_loaded:
        print("[!] Existing session expired, logging in again...")

    await login_linkedin(page, context)


async def bootstrap_linkedin_session(page, context) -> None:
    print("[*] Starting LinkedIn bootstrap session mode...")
    print("[*] A visible browser window should open.")
    print("[*] Complete any LinkedIn login, MFA, or security challenge in that browser.")
    print("[*] The script will save cookies once you land on a signed-in LinkedIn page.")

    await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
    deadline_seconds = 300

    for _ in range(deadline_seconds):
        url = page.url.lower()
        if "linkedin.com/feed" in url or "linkedin.com/mynetwork" in url or "linkedin.com/messaging" in url:
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except PlaywrightTimeoutError:
                pass
            await save_cookies(context, COOKIE_FILE)
            print(f"[+] Bootstrap complete. Session saved to {COOKIE_FILE}")
            return
        await asyncio.sleep(1)

    raise RuntimeError(
        "Timed out waiting for a successful LinkedIn login during bootstrap mode. "
        "Try again and complete the sign-in/challenge in the opened browser window."
    )


async def page_scroll_to_bottom(page, times: int) -> None:
    for _ in range(times):
        await page.keyboard.press("End")
        await asyncio.sleep(1)


async def wait_for_linkedin_page(page, timeout: int = 15000) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout)
    except PlaywrightTimeoutError:
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except PlaywrightTimeoutError:
            pass


def clean_text(value: str | None) -> str:
    return (value or "").strip()


async def safe_inner_text(element) -> str:
    if not element:
        return ""
    try:
        return clean_text(await element.inner_text())
    except Exception:
        return ""


async def safe_attr(element, attr: str) -> str:
    if not element:
        return ""
    try:
        return clean_text(await element.get_attribute(attr))
    except Exception:
        return ""


def absolute_linkedin_url(url: str) -> str:
    clean = clean_text(url)
    if not clean:
        return ""
    return f"https://www.linkedin.com{clean}" if clean.startswith("/") else clean


def parse_connection_date(text: str) -> date | None:
    cleaned = clean_text(text)
    if not cleaned:
        return None
    cleaned = re.sub(r"^Connected on\s+", "", cleaned, flags=re.IGNORECASE)
    for fmt in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def extract_first_number(text: str) -> int:
    match = re.search(r"(\d+)", clean_text(text))
    return int(match.group(1)) if match else 0


def normalize_lines(text: str) -> list[str]:
    return [line.strip() for line in clean_text(text).splitlines() if line.strip()]


def extract_connected_on_line(text: str) -> str:
    match = re.search(r"(Connected on\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})", text, flags=re.IGNORECASE)
    return clean_text(match.group(1)) if match else ""


async def extract_invitation_cards(page, mode: str) -> list[dict]:
    is_received = mode == "received"
    action_texts = ["Ignore", "Accept"] if is_received else ["Withdraw", "Pending", "Sent", "Message"]
    empty_text = "You don't have any invitations"

    extracted = await page.evaluate(
        """(config) => {
            const normalize = value => (value || "").replace(/\\s+/g, " ").trim();
            const unique = items => [...new Set(items.map(normalize).filter(Boolean))];
            const actionLabels = (config.actionTexts || []).map(value => String(value || "").toLowerCase()).filter(Boolean);
            const cards = [];
            const seen = new Set();

            const candidates = Array.from(
                document.querySelectorAll("li, div, article, section")
            ).filter(node => {
                const text = normalize(node.innerText || "");
                if (!text || text.length < 6) return false;
                if (text.includes(config.emptyText)) return false;
                const hasActionText = actionLabels.some(label => text.toLowerCase().includes(label));
                const hasProfileAnchor = !!node.querySelector("a[href*='/in/'], a[href*='linkedin.com/in/']");
                return hasActionText || hasProfileAnchor;
            });

            for (const node of candidates) {
                const text = normalize(node.innerText || "");
                const buttons = Array.from(node.querySelectorAll("button, [role='button']"))
                    .map(el => normalize(el.innerText || el.getAttribute("aria-label") || ""));
                const buttonLabels = unique(buttons);
                const hasMatchingButton = buttonLabels.some(label =>
                    actionLabels.some(action => label.toLowerCase().includes(action))
                );

                const anchor = node.querySelector("a[href*='/in/'], a[href*='linkedin.com/in/'], a.app-aware-link");
                const hasProfileAnchor = !!(anchor && normalize(anchor.getAttribute("href") || anchor.href || "").match(/linkedin\\.com\\/in\\/|^\\/in\\//i));
                if (!hasMatchingButton && !hasProfileAnchor) continue;

                const href = anchor ? (anchor.href || anchor.getAttribute("href") || "") : "";
                const key = href || text.slice(0, 200);
                if (seen.has(key)) continue;
                seen.add(key);

                const titleNode = node.querySelector(".invitation-card__title, .t-16, .artdeco-entity-lockup__title, strong");
                const subtitleNode = node.querySelector(".invitation-card__subtitle, .artdeco-entity-lockup__subtitle, .t-14");
                const noteNode = node.querySelector(".invitation-card__custom-message, .custom-message, [data-test-id='custom-message']");
                const timeNode = node.querySelector(".time-badge, time");
                const mutualNode = node.querySelector(".member-insights__count, .social-details-social-counts__count-value");

                const lines = unique((node.innerText || "").split(/\\n+/));

                const removePatterns = [
                    /^Accept$/i,
                    /^Ignore$/i,
                    /^Withdraw$/i,
                    /^Message$/i,
                    /^Pending$/i,
                    /^Sent$/i,
                    /^Follow$/i,
                    /^Connect$/i
                ];
                const name = normalize(
                    titleNode?.innerText ||
                    anchor?.innerText ||
                    lines.find(line => !removePatterns.some(pattern => pattern.test(line)) && line.length <= 80) ||
                    ""
                );

                const title = normalize(
                    subtitleNode?.innerText ||
                    lines.find(line =>
                        line &&
                        line !== name &&
                        !buttonLabels.includes(line) &&
                        !/^\\d+\\s+mutual/i.test(line) &&
                        !/^(sent|received)\\b/i.test(line) &&
                        !/^note:/i.test(line) &&
                        line.length <= 140
                    ) ||
                    ""
                );

                const note = normalize(
                    noteNode?.innerText ||
                    lines.find(line =>
                        line &&
                        line !== name &&
                        line !== title &&
                        !buttonLabels.includes(line) &&
                        /^("|').+("|')$/.test(line)
                    ) ||
                    ""
                ).replace(/^["']|["']$/g, "");

                const sentAt = normalize(
                    timeNode?.getAttribute("datetime") ||
                    timeNode?.innerText ||
                    lines.find(line => /\\b(min|hour|day|week|month|year)s? ago\\b/i.test(line)) ||
                    ""
                );

                const mutualConnections = normalize(
                    mutualNode?.innerText ||
                    lines.find(line => /mutual/i.test(line)) ||
                    ""
                );

                if (!name) continue;

                cards.push({
                    name,
                    title,
                    sent_at: sentAt,
                    note,
                    mutual_connections: mutualConnections,
                    profile_url: href
                });
            }

            return cards;
        }""",
        {"actionTexts": action_texts, "emptyText": empty_text},
    )

    return [
        {
            "name": clean_text(card.get("name")) or "Unknown",
            "title": clean_text(card.get("title")),
            "sent_at": clean_text(card.get("sent_at")),
            "note": clean_text(card.get("note")),
            "mutual_connections": clean_text(card.get("mutual_connections")),
            "profile_url": absolute_linkedin_url(card.get("profile_url", "")),
        }
        for card in extracted
        if clean_text(card.get("name"))
    ]


async def scrape_received_invites(page) -> list[dict]:
    print("[*] Scraping received invites...")
    results: list[dict] = []

    await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/received/", wait_until="domcontentloaded")
    await wait_for_linkedin_page(page)
    await asyncio.sleep(2)
    await page_scroll_to_bottom(page, 5)
    pulled_at = utc_now_iso()
    extracted = await extract_invitation_cards(page, "received")
    for row in extracted:
        row["status"] = "pending"
        row["pulled_at"] = pulled_at
        results.append(row)

    print(f"[+] Found {len(results)} received invites")
    return results


async def scrape_sent_invites(page) -> list[dict]:
    print("[*] Scraping sent invites...")
    results: list[dict] = []

    await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", wait_until="domcontentloaded")
    await wait_for_linkedin_page(page)
    await asyncio.sleep(2)
    await page_scroll_to_bottom(page, 8)
    pulled_at = utc_now_iso()
    extracted = await extract_invitation_cards(page, "sent")
    for row in extracted:
        row["status"] = "pending"
        row["pulled_at"] = pulled_at
        row.pop("note", None)
        row.pop("mutual_connections", None)
        results.append(row)

    print(f"[+] Found {len(results)} sent invites")
    return results


async def scrape_messages(page) -> list[dict]:
    print("[*] Scraping messages...")
    results: list[dict] = []

    await page.goto("https://www.linkedin.com/messaging/", wait_until="domcontentloaded")
    await wait_for_linkedin_page(page)
    await asyncio.sleep(2)

    threads = await page.query_selector_all("li.msg-conversation-listitem")
    pulled_at = utc_now_iso()

    for thread in threads:
        try:
            name = await safe_inner_text(await thread.query_selector(".msg-conversation-listitem__participant-names"))
            snippet = await safe_inner_text(await thread.query_selector(".msg-conversation-card__message-snippet-body"))
            message_date = await safe_inner_text(await thread.query_selector(".msg-conversation-listitem__time-stamp"))
            unread_el = await thread.query_selector(".notification-badge")
            thread_href = await safe_attr(await thread.query_selector("a.msg-conversation-listitem__link"), "href")
            direction = "outbound" if snippet.lower().startswith("you:") else "inbound"

            results.append(
                {
                    "name": name or "Unknown",
                    "last_message": snippet,
                    "message_date": message_date,
                    "direction": direction,
                    "is_unread": unread_el is not None,
                    "thread_url": f"https://www.linkedin.com{thread_href}" if thread_href.startswith("/") else thread_href,
                    "pulled_at": pulled_at,
                }
            )
        except Exception as exc:
            print(f"  [!] Error parsing message thread: {exc}")

    print(f"[+] Found {len(results)} message threads")
    return results


async def scrape_recent_connections(page) -> list[dict]:
    print("[*] Scraping accepted invites from recent connections...")
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", wait_until="domcontentloaded")
    await wait_for_linkedin_page(page)
    await asyncio.sleep(2)

    sort_button = page.locator('button:has-text("Recently added"), button[aria-label*="Sort by"]')
    try:
        if await sort_button.count():
            await sort_button.first.click()
            await asyncio.sleep(1)
            recent_option = page.locator('div[role="menuitem"]:has-text("Recently added"), li[role="menuitem"]:has-text("Recently added"), button:has-text("Recently added")')
            if await recent_option.count():
                await recent_option.first.click()
                await asyncio.sleep(2)
    except Exception:
        pass

    pulled_at = utc_now_iso()
    await page_scroll_to_bottom(page, 8)

    extracted = await page.evaluate(
        """() => {
            const seen = new Set();
            const rows = [];
            const anchors = Array.from(document.querySelectorAll("a[href*='/in/']"));

            for (const anchor of anchors) {
                const container =
                    anchor.closest("li") ||
                    anchor.closest(".artdeco-list__item") ||
                    anchor.closest(".mn-connection-card") ||
                    anchor.closest(".artdeco-entity-lockup") ||
                    anchor.parentElement;

                if (!container) continue;

                const text = (container.innerText || "").trim();
                if (!/Connected on\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}/i.test(text)) continue;

                const href = anchor.href || "";
                const key = href || text.slice(0, 140);
                if (seen.has(key)) continue;
                seen.add(key);

                const lines = text.split(/\\n+/).map(s => s.trim()).filter(Boolean);
                const name =
                    lines.find(line =>
                        line &&
                        !/^Connected on\\s+/i.test(line) &&
                        !/^Message$/i.test(line) &&
                        line !== "..." &&
                        line.length < 120
                    ) || (anchor.innerText || "").trim();

                const connectedOn = lines.find(line => /^Connected on\\s+/i.test(line)) || "";
                const title =
                    lines.find(line =>
                        line &&
                        line !== name &&
                        !/^Connected on\\s+/i.test(line) &&
                        !/^Message$/i.test(line) &&
                        line !== "..."
                    ) || "";

                rows.push({
                    name,
                    title,
                    connected_on: connectedOn,
                    profile_url: href
                });
            }

            return rows;
        }"""
    )

    results: list[dict] = []
    for row in extracted:
        connected_on = clean_text(row.get("connected_on"))
        name = clean_text(row.get("name"))
        if not name or not connected_on:
            continue
        connected_date = parse_connection_date(connected_on)
        results.append(
            {
                "name": name,
                "title": clean_text(row.get("title")),
                "connected_on": connected_on,
                "connected_on_date": connected_date.isoformat() if connected_date else None,
                "profile_url": absolute_linkedin_url(row.get("profile_url", "")),
                "pulled_at": pulled_at,
            }
        )

    print(f"[+] Found {len(results)} recently added connections")
    return results


async def scrape_catch_up(page) -> list[dict]:
    print("[*] Scraping LinkedIn Catch Up feed...")
    await page.goto("https://www.linkedin.com/mynetwork/", wait_until="domcontentloaded")
    await wait_for_linkedin_page(page)
    await asyncio.sleep(2)

    catch_up_tab = page.locator('button:has-text("Catch up"), a:has-text("Catch up")')
    try:
        if await catch_up_tab.count():
            await catch_up_tab.first.click()
            await asyncio.sleep(2)
    except Exception:
        pass

    await page_scroll_to_bottom(page, 5)
    pulled_at = utc_now_iso()
    extracted = await page.evaluate(
        """() => {
            const normalize = value => (value || "").replace(/\\s+/g, " ").trim();
            const unique = items => [...new Set(items.map(normalize).filter(Boolean))];
            const rows = [];
            const seen = new Set();
            const actionHints = ["say happy birthday", "congratulate", "message", "comment", "react", "reply"];

            const candidates = Array.from(document.querySelectorAll("li, div, article, section")).filter(node => {
                const text = normalize(node.innerText || "");
                if (!text || text.length < 12) return false;
                const hasProfileAnchor = !!node.querySelector("a[href*='/in/'], a[href*='linkedin.com/in/']");
                if (!hasProfileAnchor) return false;
                const lowered = text.toLowerCase();
                return actionHints.some(hint => lowered.includes(hint)) ||
                    lowered.includes("birthday") ||
                    lowered.includes("anniversary") ||
                    lowered.includes("graduat") ||
                    lowered.includes("new role") ||
                    lowered.includes("started") ||
                    lowered.includes("work anniversary");
            });

            for (const node of candidates) {
                const text = normalize(node.innerText || "");
                const anchor = node.querySelector("a[href*='/in/'], a[href*='linkedin.com/in/'], a.app-aware-link");
                if (!anchor) continue;

                const href = anchor.href || anchor.getAttribute("href") || "";
                const key = href || text.slice(0, 180);
                if (seen.has(key)) continue;
                seen.add(key);

                const lines = unique((node.innerText || "").split(/\\n+/));
                const buttonLabels = unique(
                    Array.from(node.querySelectorAll("button, [role='button'], a.artdeco-button"))
                        .map(el => normalize(el.innerText || el.getAttribute("aria-label") || ""))
                );

                const name = normalize(
                    (anchor.innerText || "").trim() ||
                    lines.find(line =>
                        line &&
                        !buttonLabels.includes(line) &&
                        !/birthday|anniversary|graduat|new role|started|congratulate|message|comment|react/i.test(line) &&
                        line.length <= 80
                    ) ||
                    ""
                );
                if (!name) continue;

                const filteredLines = lines.filter(line => line !== name && !buttonLabels.includes(line));
                const actionText = buttonLabels.find(label =>
                    /birthday|congratulate|message|comment|react|reply/i.test(label)
                ) || "";

                const eventText = filteredLines.find(line =>
                    /birthday|anniversary|graduat|new role|started|promotion|position|role|education/i.test(line)
                ) || filteredLines[0] || "";

                const title = filteredLines.find(line =>
                    line &&
                    line !== eventText &&
                    !/birthday|anniversary|graduat|new role|started|promotion|position|role|education/i.test(line) &&
                    line.length <= 140
                ) || "";

                const reactionText = filteredLines.find(line => /\\breactions?\\b/i.test(line)) || "";
                const commentText = filteredLines.find(line => /\\bcomments?\\b/i.test(line)) || "";

                rows.push({
                    name,
                    title,
                    event_text: eventText,
                    action_text: actionText,
                    reaction_text: reactionText,
                    comment_text: commentText,
                    profile_url: href
                });
            }

            return rows;
        }"""
    )

    results: list[dict] = []
    for row in extracted:
        name = clean_text(row.get("name"))
        event_text = clean_text(row.get("event_text"))
        action_text = clean_text(row.get("action_text"))
        title = clean_text(row.get("title"))
        if not name or not (event_text or action_text):
            continue

        lowered = f"{title} {event_text} {action_text}".lower()
        catch_up_type = "all"
        if "birthday" in lowered:
            catch_up_type = "birthday"
        elif "anniversary" in lowered:
            catch_up_type = "work_anniversary"
        elif "education" in lowered or "graduat" in lowered:
            catch_up_type = "education"
        elif "job" in lowered or "position" in lowered or "role" in lowered or "started" in lowered or "promotion" in lowered:
            catch_up_type = "job_change"

        results.append(
            {
                "name": name,
                "title": title,
                "catch_up_type": catch_up_type,
                "event_text": event_text,
                "action_text": action_text,
                "reaction_count": extract_first_number(row.get("reaction_text", "")),
                "comment_count": extract_first_number(row.get("comment_text", "")),
                "profile_url": absolute_linkedin_url(row.get("profile_url", "")),
                "pulled_at": pulled_at,
            }
        )

    print(f"[+] Found {len(results)} catch up items")
    return results


def replace_table_rows(supabase: Client, table: str, rows: list[dict]) -> None:
    print(f"[*] Replacing rows in {table}...")
    # Clear the table first so the dashboard always reflects the latest scrape.
    supabase.table(table).delete().gte("pulled_at", "1900-01-01T00:00:00+00:00").execute()
    if not rows:
        print(f"[!] No rows found for {table}; table cleared.")
        return
    supabase.table(table).insert(rows).execute()
    print(f"[+] Pushed {len(rows)} rows to {table}")


async def main() -> None:
    print("=" * 56)
    print(" Midas Tech LinkedIn Scraper — Daily Pull")
    print(f" {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 56)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=HEADLESS)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 1200},
        )
        page = await context.new_page()

        if BOOTSTRAP_SESSION_ONLY:
            await bootstrap_linkedin_session(page, context)
            await browser.close()
            return

        supabase = get_supabase()
        await ensure_linkedin_session(page, context)

        received = await scrape_received_invites(page)
        sent = await scrape_sent_invites(page)
        messages = await scrape_messages(page)
        accepted = await scrape_recent_connections(page)
        catch_up = await scrape_catch_up(page)

        replace_table_rows(supabase, "linkedin_received_invites", received)
        replace_table_rows(supabase, "linkedin_sent_invites", sent)
        replace_table_rows(supabase, "linkedin_message_replies", messages)
        replace_table_rows(supabase, "linkedin_accepted_invites", accepted)
        replace_table_rows(supabase, "linkedin_catch_up", catch_up)

        await save_cookies(context, COOKIE_FILE)
        await browser.close()

    print("\n[+] Done. LinkedIn data pushed to Supabase.")
    print("=" * 56)


if __name__ == "__main__":
    asyncio.run(main())
