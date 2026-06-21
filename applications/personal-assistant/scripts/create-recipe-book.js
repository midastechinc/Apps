/**
 * One-time script: parses the Flour & Spice recipe .docx and creates a
 * well-organised Google Doc called "Jaffar Family Recipe Book".
 *
 * Triggered via GET /api/create-recipe-book?key=ADMIN_KEY
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { createDoc, appendToDoc } = require('../tools/google-docs');

const DOCX_PATH = path.join(__dirname, '..', 'data', 'recipe-book.docx');
const DOC_TITLE = 'Jaffar Family Recipe Book 🍛';

// ─── Category normalisation map ──────────────────────────────────────────────
// Maps the raw section headings in the docx to clean display names + order
const CATEGORY_MAP = {
  'appetizer':              { label: 'APPETIZERS & SNACKS',    order: 1 },
  'breakfast':              { label: 'BREAKFAST & BRUNCH',     order: 2 },
  'brunch':                 { label: 'BREAKFAST & BRUNCH',     order: 2 },
  'main course':            { label: 'MAIN COURSE',            order: 3 },
  'rice dish':              { label: 'RICE DISHES',            order: 4 },
  'raita, sides, chutney':  { label: 'RAITAS, SIDES & CHUTNEYS', order: 5 },
  'side':                   { label: 'RAITAS, SIDES & CHUTNEYS', order: 5 },
  'side dish':              { label: 'RAITAS, SIDES & CHUTNEYS', order: 5 },
  'condiments':             { label: 'CONDIMENTS & SAUCES',    order: 6 },
  'dessert':                { label: 'DESSERTS',               order: 7 },
  'drinks':                 { label: 'DRINKS',                 order: 8 },
  'recipes':                { label: 'MISCELLANEOUS',          order: 9 },
  'spice':                  { label: 'SPICES & SPICE MIXES',   order: 10 },
  'spice mix':              { label: 'SPICES & SPICE MIXES',   order: 10 },
};

// Known single-word categories that are section headers (all lowercase)
const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_MAP));

// ─── Docx text extraction ────────────────────────────────────────────────────
function extractDocxText(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('word/document.xml not found in docx');
  const xml = entry.getData().toString('utf-8');

  // Each <w:p> becomes a newline-separated paragraph
  const lines = [];
  const paras = xml.split(/<w:p[ >]/);
  for (const para of paras) {
    // Strip all XML tags
    const text = para.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').trim();
    if (text) lines.push(text);
  }
  return lines;
}

// ─── Parse into recipe objects ───────────────────────────────────────────────
function parseRecipes(lines) {
  const sections = [];   // { category, recipes: [{ name, lines[] }] }
  let currentCategory = null;
  let currentRecipe = null;

  const getOrCreateSection = (cat) => {
    let sec = sections.find(s => s.category === cat);
    if (!sec) { sec = { category: cat, recipes: [] }; sections.push(sec); }
    return sec;
  };

  // Skip the header lines (title, subtitle, ToC placeholder)
  let i = 0;
  // Skip until we hit a known category
  while (i < lines.length && !KNOWN_CATEGORIES.has(lines[i].toLowerCase())) i++;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase().trim();

    if (KNOWN_CATEGORIES.has(lower)) {
      currentCategory = lower;
      currentRecipe = null;
      continue;
    }

    if (!currentCategory) continue;

    // Detect a new recipe: a line followed by a description-ish line
    // Recipe names are typically title-case and don't start with a number or bullet
    const isIngredientHeader = lower === 'ingredients';
    const isInstructionHeader = lower === 'instructions';
    const isNotesHeader = lower === 'notes';
    const isSource = lower.startsWith('source:');
    const isIngredientLine = /^\d[\d./]* (tsp|tbsp|cup|lb|oz|g|ml|inch|clove|piece|sprig|bunch|can|pkg|package|slice|tbsp|handful|pinch|dash|pkg)/i.test(line);
    const isNumberedStep = /^\d+\.\s/.test(line);

    if (!isIngredientHeader && !isInstructionHeader && !isNotesHeader &&
        !isSource && !isIngredientLine && !isNumberedStep &&
        !lower.startsWith('•') && !lower.startsWith('-') && !lower.startsWith('*') &&
        currentRecipe === null) {
      // This looks like a recipe name
      const sec = getOrCreateSection(currentCategory);
      currentRecipe = { name: line, description: '', ingredients: [], instructions: [], notes: '', source: '' };
      sec.recipes.push(currentRecipe);
      continue;
    }

    if (!currentRecipe) continue;

    if (isSource) {
      currentRecipe.source = line.replace(/^source:\s*/i, '').trim();
      currentRecipe = null; // Recipe ends at source
      continue;
    }

    if (isIngredientHeader || isInstructionHeader || isNotesHeader) continue;

    if (isNumberedStep) {
      currentRecipe.instructions.push(line);
    } else if (isIngredientLine || lower.startsWith('•') || lower.startsWith('-') || /^\d+[\d./]* /.test(line)) {
      currentRecipe.ingredients.push(line);
    } else if (currentRecipe.instructions.length > 0) {
      // Continuation of last instruction or a note
      if (currentRecipe.instructions.length) {
        currentRecipe.instructions[currentRecipe.instructions.length - 1] += ' ' + line;
      }
    } else if (currentRecipe.ingredients.length > 0) {
      currentRecipe.ingredients.push(line);
    } else {
      currentRecipe.description += (currentRecipe.description ? ' ' : '') + line;
    }
  }

  return sections;
}

// ─── Format a section as plain text ─────────────────────────────────────────
function formatSection(section) {
  const meta = CATEGORY_MAP[section.category] || { label: section.category.toUpperCase() };
  const divider = '═'.repeat(56);
  const thinLine = '─'.repeat(56);

  let out = `\n\n${divider}\n${meta.label}\n${divider}\n`;

  for (const recipe of section.recipes) {
    out += `\n${recipe.name.toUpperCase()}\n`;
    if (recipe.description) out += `${recipe.description}\n`;
    if (recipe.ingredients.length) {
      out += `\nIngredients:\n`;
      for (const ing of recipe.ingredients) out += `  • ${ing}\n`;
    }
    if (recipe.instructions.length) {
      out += `\nInstructions:\n`;
      for (const step of recipe.instructions) out += `  ${step}\n`;
    }
    if (recipe.notes) out += `\nNotes: ${recipe.notes}\n`;
    if (recipe.source) out += `\nSource: ${recipe.source}\n`;
    out += `\n${thinLine}\n`;
  }

  return out;
}

// ─── Build table of contents ─────────────────────────────────────────────────
function buildTOC(sections) {
  let toc = 'TABLE OF CONTENTS\n' + '─'.repeat(40) + '\n\n';
  const ordered = [...sections].sort((a, b) => {
    const oa = (CATEGORY_MAP[a.category] || {}).order || 99;
    const ob = (CATEGORY_MAP[b.category] || {}).order || 99;
    return oa - ob;
  });

  const seen = new Set();
  for (const sec of ordered) {
    const label = (CATEGORY_MAP[sec.category] || { label: sec.category.toUpperCase() }).label;
    if (seen.has(label)) continue;
    seen.add(label);
    toc += `  ${label}\n`;
    // Get all recipes across sections with same label
    for (const s of sections.filter(x => (CATEGORY_MAP[x.category] || {}).label === label)) {
      for (const r of s.recipes) {
        toc += `    - ${r.name}\n`;
      }
    }
    toc += '\n';
  }
  return toc;
}

// ─── Main creation function ──────────────────────────────────────────────────
async function createRecipeBook() {
  if (!fs.existsSync(DOCX_PATH)) {
    return { error: `Recipe book file not found at ${DOCX_PATH}` };
  }

  console.log('[RECIPE] Parsing docx...');
  const lines = extractDocxText(DOCX_PATH);
  const sections = parseRecipes(lines);
  console.log(`[RECIPE] Found ${sections.length} sections, ${sections.reduce((t, s) => t + s.recipes.length, 0)} recipes`);

  // Build intro block
  const header = `JAFFAR FAMILY RECIPE BOOK\nFlour & Spice Collection\n\nPersonal backup for family use. Recipes sourced from flourandspiceblog.com.\nNot for redistribution.\n\n`;
  const toc = buildTOC(sections);

  // Create the doc with header + TOC
  console.log('[RECIPE] Creating Google Doc...');
  const doc = await createDoc({ title: DOC_TITLE, content: header + toc });
  if (doc.error) return doc;

  console.log(`[RECIPE] Doc created: ${doc.url}`);

  // Append each section (sorted by order)
  const ordered = [...sections].sort((a, b) => {
    const oa = (CATEGORY_MAP[a.category] || {}).order || 99;
    const ob = (CATEGORY_MAP[b.category] || {}).order || 99;
    return oa - ob;
  });

  // Merge duplicate categories
  const merged = [];
  const seen = new Map();
  for (const sec of ordered) {
    const label = (CATEGORY_MAP[sec.category] || { label: sec.category }).label;
    if (seen.has(label)) {
      seen.get(label).recipes.push(...sec.recipes);
    } else {
      const copy = { category: sec.category, recipes: [...sec.recipes] };
      seen.set(label, copy);
      merged.push(copy);
    }
  }

  for (const sec of merged) {
    const content = formatSection(sec);
    console.log(`[RECIPE] Appending section: ${sec.category} (${sec.recipes.length} recipes, ${content.length} chars)`);
    const result = await appendToDoc({ documentId: doc.documentId, content });
    if (result.error) {
      console.error(`[RECIPE] Append failed for ${sec.category}:`, result.error);
    }
  }

  console.log('[RECIPE] Done!');
  return {
    success: true,
    title: DOC_TITLE,
    url: doc.url,
    documentId: doc.documentId,
    sections: merged.length,
    totalRecipes: merged.reduce((t, s) => t + s.recipes.length, 0)
  };
}

module.exports = { createRecipeBook };
