// Remplace le domaine factice (square-packing-lab.example) par votre domaine dans dist/.
//   SITE_URL=https://mon-domaine.fr npm run build:prod      ou      node scripts/set-domain.mjs https://mon-domaine.fr [dossier]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const PLACEHOLDER = 'https://square-packing-lab.example';
const url = (process.argv[2] || process.env.SITE_URL || '').replace(/\/+$/, ''), dir = process.argv[3] || 'dist';
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) { console.error('Usage : SITE_URL=https://mon-domaine.fr node scripts/set-domain.mjs  (https obligatoire, sans chemin)'); process.exit(1); }
let files = 0;
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(html|xml|txt|json|webmanifest)$/.test(f)) { const s = readFileSync(p, 'utf8'); if (s.includes(PLACEHOLDER)) { writeFileSync(p, s.split(PLACEHOLDER).join(url)); files++; } } } })(dir);
console.log(`${files} fichier(s) mis à jour → ${url}`);
