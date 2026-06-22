'use strict';

// Ported from LeadTracker's midas-social-generator.html (buildImagePrompt and helpers).
// Generates the same structured image prompts that LeadTracker's "Copy Image Prompt" button produces.

const IMAGE_PROMPT_TYPES = {
  editorial_photo: {
    ig: {
      intro: 'Create a single-message Instagram graphic (square 1:1) with one bold headline and an optional support line.',
      style: 'Style: clean, high-contrast, simple, emotional',
      palette: 'Color palette: dark or light background with one or two strong accent colors',
      visual: ['- one big headline only', '- optional one-line supporting line', '- lots of spacing and no clutter'],
      mood: 'Mood: urgent, curious, memorable',
      typography: 'Typography: oversized headline, compact support line, strong hierarchy'
    },
    li: {
      intro: 'Create a single-message LinkedIn graphic (square 1:1 or landscape 4:5) with one bold headline and minimal supporting copy.',
      style: 'Style: executive, simple, high-contrast',
      palette: 'Color palette: restrained blues, greys, and a single accent color',
      visual: ['- one idea only', '- keep the layout clean and spacious', '- let the headline carry the message'],
      mood: 'Mood: direct, credible, polished',
      typography: 'Typography: bold headline, restrained subline, strong spacing'
    }
  },
  infographic: {
    ig: {
      intro: 'Create an infographic for Instagram (square 1:1) with a clear title and 3 to 5 short key points.',
      style: 'Style: structured, educational, modern',
      palette: 'Color palette: dark or light background with blue, white, and accent colors',
      visual: ['- clear title at the top', '- 3 to 5 icon-led sections', '- short labels, no paragraphs'],
      mood: 'Mood: informative, crisp, scannable',
      typography: 'Typography: strong headings, short body copy, clean hierarchy'
    },
    li: {
      intro: 'Create an infographic for LinkedIn (square 1:1 or landscape 4:5) with a clear title and 3 to 5 short key points.',
      style: 'Style: corporate, structured, educational',
      palette: 'Color palette: blue/grey tones with enough contrast for readability',
      visual: ['- organize content into sections or a grid', '- use simple icons for each point', '- keep the layout mobile-friendly'],
      mood: 'Mood: professional, practical, clear',
      typography: 'Typography: simple corporate font, strong hierarchy'
    }
  },
  checklist_card: {
    ig: {
      intro: 'Create a checklist graphic for Instagram (square 1:1) with a "Do this now" tone and 3 to 5 action steps.',
      style: 'Style: direct, practical, list-led',
      palette: 'Color palette: dark background with blue accents and bright checkmarks',
      visual: ['- title should feel action-oriented', '- use checkbox or icon markers for each step', '- keep the wording short and actionable'],
      mood: 'Mood: helpful, urgent, practical',
      typography: 'Typography: bold title, readable checklist rows, strong spacing'
    },
    li: {
      intro: 'Create a checklist graphic for LinkedIn (square 1:1 or landscape 4:5) with a "Do this now" tone and 3 to 5 action steps.',
      style: 'Style: corporate, organized, actionable',
      palette: 'Color palette: blue/grey tones with simple check icons',
      visual: ['- keep the checklist short and easy to scan', '- use clear checkboxes or numbered steps', '- let the title set the urgency'],
      mood: 'Mood: calm, useful, decisive',
      typography: 'Typography: strong title, compact action text, clean hierarchy'
    }
  },
  workflow_diagram: {
    ig: {
      intro: 'Create a Problem → Solution Instagram graphic (square 1:1) with a split layout.',
      style: 'Style: contrast-driven, clean, direct',
      palette: 'Color palette: red or orange for the problem side, blue or green for the solution side',
      visual: ['- left side shows the problem', '- right side shows the solution', '- use icons or symbols instead of long text'],
      mood: 'Mood: practical, persuasive, clear',
      typography: 'Typography: short labels, strong contrast, simple hierarchy'
    },
    li: {
      intro: 'Create a Problem → Solution LinkedIn graphic (square 1:1 or landscape 4:5) with a split layout.',
      style: 'Style: professional comparison, clear contrast',
      palette: 'Color palette: restrained red vs blue/green contrast',
      visual: ['- split the design into problem and solution sides', '- keep labels short and readable', '- make the comparison obvious at a glance'],
      mood: 'Mood: credible, structured, persuasive',
      typography: 'Typography: readable labels, clean layout, clear contrast'
    }
  },
  comparison_card: {
    ig: {
      intro: 'Create a case study or scenario Instagram graphic (square 1:1) using a simple three-part flow.',
      style: 'Style: narrative, structured, clear',
      palette: 'Color palette: consistent across all sections with subtle contrast',
      visual: ['- show Situation, Problem, and Outcome', '- use a timeline or flow layout', '- keep each section short'],
      mood: 'Mood: real-world, reflective, persuasive',
      typography: 'Typography: clear section labels, concise text, strong hierarchy'
    },
    li: {
      intro: 'Create a case study or scenario LinkedIn graphic (square 1:1 or landscape 4:5) using a simple three-part flow.',
      style: 'Style: professional, story-led, clean',
      palette: 'Color palette: blue/grey tones with subtle section contrast',
      visual: ['- structure the post as a small story', '- keep the three sections easy to follow', '- focus on the business outcome'],
      mood: 'Mood: credible, informative, human',
      typography: 'Typography: simple labels, readable flow, strong hierarchy'
    }
  },
  stats_card: {
    ig: {
      intro: 'Create a stats highlight Instagram graphic (square 1:1) centered on one big number.',
      style: 'Style: minimal, bold, data-led',
      palette: 'Color palette: dark background with a bright accent color for the number',
      visual: ['- one big number in the center', '- short explanation below', '- optional tiny source line'],
      mood: 'Mood: sharp, credible, urgent',
      typography: 'Typography: oversized number, short label, strong contrast'
    },
    li: {
      intro: 'Create a stats highlight LinkedIn graphic (square 1:1 or landscape 4:5) centered on one big number.',
      style: 'Style: executive, minimal, metric-first',
      palette: 'Color palette: blue/grey tones with a clean accent color',
      visual: ['- let the number dominate the layout', '- keep the explanation short and clean', '- avoid clutter around the metric'],
      mood: 'Mood: analytical, confident, concise',
      typography: 'Typography: large number, compact explanation, strong hierarchy'
    }
  },
  quote_card: {
    ig: {
      intro: 'Create a thought leadership Instagram graphic (square 1:1) with one strong insight or belief.',
      style: 'Style: minimal, editorial, authoritative',
      palette: 'Color palette: clean background with restrained brand accents',
      visual: ['- one insight or belief only', '- company or name can sit small at the bottom', '- leave lots of breathing room'],
      mood: 'Mood: authentic, confident, expert',
      typography: 'Typography: bold quote text, minimal supporting text'
    },
    li: {
      intro: 'Create a thought leadership LinkedIn graphic (square 1:1 or landscape 4:5) with one strong insight or belief.',
      style: 'Style: executive, polished, minimal',
      palette: 'Color palette: light or dark background with subtle branding',
      visual: ['- keep the design clean and professional', '- use the company or name as a small footer mark', '- make the insight the focal point'],
      mood: 'Mood: trustworthy, thoughtful, expert',
      typography: 'Typography: strong quote, clear spacing, minimal clutter'
    }
  },
  carousel_slides: {
    ig: {
      intro: 'Create an Instagram carousel with multiple slides. Slide 1 should be a bold hook, slides 2 to 4 should cover the problem or insights, and the last slide should end with a CTA.',
      style: 'Style: multi-page, consistent, minimalist, high-readability',
      palette: 'Color palette: consistent across all slides with strong contrast and one accent color',
      visual: ['- one idea per slide', '- keep every slide very simple', '- maintain the same visual system across the full set'],
      mood: 'Mood: educational, persuasive, sequential',
      typography: 'Typography: large slide headlines, minimal subtext, consistent sizing'
    },
    li: {
      intro: 'Create a LinkedIn carousel with multiple slides. Slide 1 should be a bold hook, slides 2 to 4 should cover the problem or insights, and the final slide should end with a CTA.',
      style: 'Style: professional, editorial, multi-page',
      palette: 'Color palette: consistent across slides with restrained brand accents',
      visual: ['- keep each slide focused on one point', '- use the same spacing, colors, and typography throughout', '- make the slides easy to read on mobile'],
      mood: 'Mood: thoughtful, structured, authoritative',
      typography: 'Typography: strong headline hierarchy, compact supporting copy'
    }
  },
  alert_warning: {
    ig: {
      intro: 'Create an alert / warning Instagram graphic (square 1:1) with a strong headline and subtle red accents.',
      style: 'Style: urgent, minimal, high-contrast',
      palette: 'Color palette: dark background with restrained red accents and white text',
      visual: ['- one risk should be obvious immediately', '- keep the mood slightly intense', '- no clutter, no busy overlays'],
      mood: 'Mood: urgent, serious, attention-grabbing',
      typography: 'Typography: bold warning headline, strong contrast, short support text'
    },
    li: {
      intro: 'Create an alert / warning LinkedIn graphic (square 1:1 or landscape 4:5) with a strong headline and subtle red accents.',
      style: 'Style: professional alert, restrained, clean',
      palette: 'Color palette: blue/grey base with careful red accents',
      visual: ['- keep one risk front and center', '- use a serious, business-appropriate tone', '- avoid overly dramatic visuals'],
      mood: 'Mood: serious, credible, restrained',
      typography: 'Typography: clear warning headline, short support line, clean spacing'
    }
  },
  personal_brand_authority: {
    ig: {
      intro: 'Create a personal brand authority Instagram graphic (square 1:1) using a clean professional portrait and one strong insight.',
      style: 'Style: authentic, professional, minimal',
      palette: 'Color palette: natural, clean, with subtle brand accents',
      visual: ['- include a clean professional photo of the person', '- add one insight or belief only', '- keep the branding subtle and authentic'],
      mood: 'Mood: confident, human, trustworthy',
      typography: 'Typography: short headline, small name/company line, strong readability'
    },
    li: {
      intro: 'Create a personal brand authority LinkedIn graphic (square 1:1 or landscape 4:5) using a clean professional portrait and one strong insight.',
      style: 'Style: professional, editorial, authentic',
      palette: 'Color palette: restrained and polished, with subtle brand accents',
      visual: ['- use the person\'s photo as the focal point', '- keep the message honest and non-salesy', '- leave room for the name and company at the bottom'],
      mood: 'Mood: credible, personal, expert',
      typography: 'Typography: concise headline, clean name block, strong spacing'
    }
  }
};

const DEFAULT_TYPE = 'editorial_photo';

function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function quote(value) { return `"${norm(value).replace(/"/g, "'")}"` ; }
function truncWords(value, max) {
  const words = norm(value).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}...`;
}
function firstSentence(value) {
  const s = norm(value);
  if (!s) return '';
  const m = s.match(/^(.+?[.!?])(?:\s|$)/);
  return m ? m[1].trim() : s;
}

function pickImageType(post) {
  const text = `${post.headline || ''} ${post.category || ''} ${post.caption || ''} ${post.topic || ''}`.toLowerCase();
  if (/alert|warning|risk|threat|urgent|critical|red flag|breach|downtime|attack/.test(text)) return 'alert_warning';
  if (/checklist|do this now|steps|action steps|fix|audit|review/.test(text)) return 'checklist_card';
  if (/stat|stats|number|trend|percent|report|data|metric/.test(text)) return 'stats_card';
  if (/problem|solution|before|after|compare|versus|vs|fix|improve|workflow/.test(text)) return 'workflow_diagram';
  if (/guide|how to|tips|steps|process|list|educational|learn|explain/.test(text)) return 'infographic';
  if (/quote|statement|belief|insight|thought leadership|authority|opinion/.test(text)) return 'quote_card';
  if (/case study|scenario|story|situation|outcome|timeline/.test(text)) return 'comparison_card';
  return DEFAULT_TYPE;
}

function getConfig(type, platform) {
  const t = IMAGE_PROMPT_TYPES[type] || IMAGE_PROMPT_TYPES[DEFAULT_TYPE];
  const p = (platform === 'linkedin' || platform === 'google') ? 'li' : 'ig';
  return t[p];
}

function buildImagePrompt(post, platform, imageType) {
  const type = IMAGE_PROMPT_TYPES[imageType] ? imageType : pickImageType(post);
  const config = getConfig(type, platform);

  const topic = norm(post.topic || post.category || post.headline || 'Business cybersecurity');
  const headline = norm(post.headline || post.category || topic);
  const subtext = firstSentence(post.caption || '') ||
    truncWords(post.caption || '', platform === 'linkedin' ? 16 : 14) ||
    `A clear message about why ${topic} matters.`;
  const supportLine = truncWords(post.caption || '', platform === 'linkedin' ? 14 : 10);
  const cta = norm(post.cta || (platform === 'linkedin' ? "Let's review your setup" : 'Is Your Business Secure?'));
  // Footer is composited by image-gen.js after generation — omit from AI prompt to avoid hallucination
  const footer = '';

  const lines = [
    config.intro, '',
    `Topic: ${topic}`, '',
    config.style,
    config.palette, '',
    'Main headline (large, bold):',
    quote(headline), '',
    'Subtext (smaller):',
    quote(subtext), '',
    'Supporting text (keep short, optional):',
    quote(supportLine)
  ];

  // Type-specific layout instruction
  const layouts = {
    carousel_slides:  ['', 'Carousel blueprint:', '- Slide 1: bold hook with curiosity or urgency', '- Slides 2 to 4: problem, insights, or explanation', '- Next slides: solution, tips, or action steps', '- Last slide: CTA with a clean ending', '- keep one idea per slide'],
    workflow_diagram: ['', 'Split layout:', '- left side shows the problem', '- right side shows the solution', '- use icons or symbols instead of long text'],
    stats_card:       ['', 'Stats layout:', '- make one big number the hero', '- keep the explanation short', '- source text can stay small and subtle'],
    checklist_card:   ['', 'Checklist layout:', '- title should feel action-oriented', '- use 3 to 5 steps max', '- use checkbox or icon markers'],
    quote_card:       ['', 'Quote layout:', '- one strong insight or belief only', '- company or name can appear small at the bottom', '- keep the design minimal and authentic'],
    infographic:      ['', 'Infographic layout:', '- break the content into short sections', '- use icons, numbers, or labeled blocks', '- keep the structure simple and scannable'],
    alert_warning:    ['', 'Alert layout:', '- strong warning headline', '- subtle red accents only', '- one clear risk, no clutter'],
    personal_brand_authority: ['', 'Authority layout:', '- use a clean professional portrait if available', '- place the name and company small at the bottom', '- keep the message authentic and non-salesy'],
    comparison_card:  ['', 'Scenario layout:', '- show Situation → Problem → Outcome', '- keep the structure short and simple', '- use a timeline or flow format']
  };
  lines.push(...(layouts[type] || ['', 'Single-message layout:', '- one big headline only', '- optional one-line support text', '- lots of breathing room']));

  lines.push(
    '', 'Visual elements:', ...config.visual,
    '', 'Call to action (bottom):', quote(cta),
    '', 'Branding note: leave the bottom 80px of the image clear — branding footer will be added in post-processing.',
    '', config.mood,
    'Quality: sharp, high-resolution, clean spacing, highly readable',
    config.typography
  );

  return lines.join('\n');
}

module.exports = { buildImagePrompt, pickImageType };
