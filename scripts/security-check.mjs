#!/usr/bin/env node

/**
 * Guhan Sanctuary — Automated Pre-Deployment Security & Integrity Checker
 * 
 * Verifies:
 * 1. Zero-Hardcoding: Scans for leaked secrets (API keys, private keys, service accounts).
 * 2. Sensitive Files: Ensures .env* (except .env.example) and credentials are not staged/tracked.
 * 3. Firestore Rules: Enforces isolated user tenancy and 7-day immutability grace period.
 * 4. Storage Rules: Enforces isolated media storage, MIME validation, and <= 5MB limit.
 * 5. Cloud Run Container Security: Validates Dockerfile non-root user and configuration.
 * 6. TypeScript Compilation: Guarantees zero type errors prior to Cloud Run build.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const isFullScan = process.argv.includes('--full');
const isStagedOnly = process.argv.includes('--staged');

console.log('\n🔒 [Guhan Security Shield] Running pre-deployment security verification...');
if (isFullScan) console.log('   Mode: Full Security & Build Audit (Pre-Push)');
else if (isStagedOnly) console.log('   Mode: Staged Changes Audit (Pre-Commit)');
else console.log('   Mode: Standard Security Audit');

let failures = 0;

function logPass(msg) {
  console.log(`   ✅ PASS: ${msg}`);
}

function logFail(msg, details = null) {
  failures++;
  console.error(`   ❌ FAIL: ${msg}`);
  if (details) console.error(`      ${details}`);
}

// ----------------------------------------------------------------------------
// 1. Scan for Sensitive / Disallowed Files in Git
// ----------------------------------------------------------------------------
console.log('\n[1/5] Checking for sensitive or prohibited files...');
try {
  let fileList = [];
  if (isStagedOnly) {
    const stdout = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf-8' });
    fileList = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } else {
    const stdout = execSync('git ls-files', { encoding: 'utf-8' });
    fileList = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  const forbiddenPatterns = [
    /^\.env(?:\.local|\.production|\.development)?$/,
    /\.pem$/i,
    /\.key$/i,
    /service[_-]?account.*\.json$/i,
    /credentials.*\.json$/i,
    /\.tsbuildinfo$/i,
  ];

  let sensitiveFound = false;
  for (const file of fileList) {
    // Allow .env.example
    if (file === '.env.example' || file === '.dockerignore' || file === '.gitignore') continue;

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(file) || pattern.test(path.basename(file))) {
        logFail(`Sensitive or cache file tracked by Git: "${file}"`, 'Remove from Git tracking: git rm --cached ' + file);
        sensitiveFound = true;
      }
    }
  }

  if (!sensitiveFound) {
    logPass('No sensitive environment, key, or cache files detected in Git tracking.');
  }
} catch (err) {
  logFail('Failed to inspect Git file list', err.message);
}

// ----------------------------------------------------------------------------
// 2. Secret Scanner (Zero-Hardcoding Verification)
// ----------------------------------------------------------------------------
console.log('\n[2/5] Scanning code for leaked credentials & private keys...');
try {
  let filesToScan = [];
  if (isStagedOnly) {
    const stdout = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf-8' });
    filesToScan = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } else {
    const stdout = execSync('git ls-files', { encoding: 'utf-8' });
    filesToScan = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  const scannableExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml'];

  const secretRules = [
    {
      name: 'Private Key block',
      regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g,
    },
    {
      name: 'Firebase Service Account Private Key',
      regex: /"private_key"\s*:\s*"-----BEGIN/g,
    },
    {
      name: 'Gemini AI Studio API Key (AQ....)',
      regex: /AQ\.[A-Za-z0-9_\-\.]{25,}/g,
      filter: (match) => !match.includes('YOUR_') && !match.includes('placeholder'),
    },
    {
      name: 'Hardcoded API Key / Secret assignment',
      regex: /(?:GEMINI_API_KEY|API_KEY|SECRET_KEY|PRIVATE_KEY)\s*[:=]\s*['"][A-Za-z0-9_\-\.]{15,}['"]/gi,
      filter: (match, file) => {
        if (file.includes('firebase-applet-config.json') || file.includes('package-lock.json')) return false;
        if (match.includes('YOUR_') || match.includes('placeholder') || match.includes('process.env')) return false;
        return true;
      },
    },
  ];

  let leaksCount = 0;
  for (const relPath of filesToScan) {
    const ext = path.extname(relPath).toLowerCase();
    if (!scannableExtensions.includes(ext)) continue;
    if (!fs.existsSync(relPath)) continue;

    const content = fs.readFileSync(relPath, 'utf-8');

    for (const rule of secretRules) {
      const matches = content.match(rule.regex);
      if (matches) {
        for (const m of matches) {
          if (!rule.filter || rule.filter(m, relPath)) {
            logFail(
              `Potential ${rule.name} detected in ${relPath}`,
              `Matched snippet: ${m.substring(0, 40)}... (Store secrets in Secret Manager)`
            );
            leaksCount++;
          }
        }
      }
    }
  }

  if (leaksCount === 0) {
    logPass('Codebase clean. Zero hardcoded secrets or private keys detected.');
  }
} catch (err) {
  logFail('Error running secret scanner', err.message);
}

// ----------------------------------------------------------------------------
// 3. Firestore & Storage Security Rules Integrity
// ----------------------------------------------------------------------------
console.log('\n[3/5] Verifying Firestore and Firebase Storage security rules...');

// Firestore Rules
const firestoreRulesPath = path.join(process.cwd(), 'firestore.rules');
if (!fs.existsSync(firestoreRulesPath)) {
  logFail('firestore.rules file missing from project root');
} else {
  const rules = fs.readFileSync(firestoreRulesPath, 'utf-8');
  const hasVersion2 = /rules_version\s*=\s*'2';/.test(rules);
  const hasUserIsolation = /match\s+\/users\/\{userId\}\/\{document=\*\*\}/.test(rules);
  const has7DayImmutability = /duration\.value\s*\(\s*7\s*,\s*['"]d['"]\s*\)/.test(rules);
  const hasDefaultDeny = /match\s+\/\{document=\*\*\s*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/.test(rules);

  if (!hasVersion2) logFail('firestore.rules must use rules_version = \'2\'');
  if (!hasUserIsolation) logFail('firestore.rules missing user boundary isolation rule');
  if (!has7DayImmutability) logFail('firestore.rules missing mandatory 7-day immutability constraint');
  if (!hasDefaultDeny) logFail('firestore.rules missing strict default-deny rule');

  if (hasVersion2 && hasUserIsolation && has7DayImmutability && hasDefaultDeny) {
    logPass('firestore.rules verified: User isolation & 7-day immutability enforced.');
  }
}

// Storage Rules
const storageRulesPath = path.join(process.cwd(), 'storage.rules');
if (!fs.existsSync(storageRulesPath)) {
  logFail('storage.rules file missing from project root');
} else {
  const sRules = fs.readFileSync(storageRulesPath, 'utf-8');
  const hasMediaIsolation = /match\s+\/users\/\{userId\}\/media\/\{fileName\}/.test(sRules);
  const hasMimeCheck = /contentType\.matches\('image\/.*'\)\s*\|\|\s*request\.resource\.contentType\.matches\('video\/.*'\)/.test(sRules);
  const hasSizeLimit = /request\.resource\.size\s*<=\s*5242880/.test(sRules);
  const hasUpdateBlocked = /allow\s+update:\s*if\s+false;/.test(sRules);

  if (!hasMediaIsolation) logFail('storage.rules missing user media boundary rule');
  if (!hasMimeCheck) logFail('storage.rules missing MIME type validation for media');
  if (!hasSizeLimit) logFail('storage.rules missing <= 5MB size limit validation');
  if (!hasUpdateBlocked) logFail('storage.rules must enforce immutable media: allow update: if false;');

  if (hasMediaIsolation && hasMimeCheck && hasSizeLimit && hasUpdateBlocked) {
    logPass('storage.rules verified: MIME check, 5MB limit & immutable attachments enforced.');
  }
}

// ----------------------------------------------------------------------------
// 4. Cloud Run Dockerfile Security & Configuration
// ----------------------------------------------------------------------------
console.log('\n[4/5] Checking Cloud Run Dockerfile and configuration...');
const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
if (!fs.existsSync(dockerfilePath)) {
  logFail('Dockerfile missing from project root');
} else {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
  const hasNonRootUser = /USER\s+nextjs/.test(dockerfile);
  const hasPort8080 = /ENV\s+PORT\s*=\s*8080/.test(dockerfile) || /EXPOSE\s+8080/.test(dockerfile);
  const hasHostname = /ENV\s+HOSTNAME\s*=\s*["']?0\.0\.0\.0["']?/.test(dockerfile);
  const hasStandalone = /COPY.*\.next\/standalone/.test(dockerfile);

  if (!hasNonRootUser) logFail('Dockerfile must run as non-root user (USER nextjs) for Cloud Run security compliance');
  if (!hasPort8080) logFail('Dockerfile must expose or set PORT 8080 for Cloud Run');
  if (!hasHostname) logFail('Dockerfile must set HOSTNAME=0.0.0.0 for Next.js standalone container routing');
  if (!hasStandalone) logFail('Dockerfile must utilize .next/standalone output');

  if (hasNonRootUser && hasPort8080 && hasHostname && hasStandalone) {
    logPass('Dockerfile verified: Secure non-root standalone container configured.');
  }
}

// ----------------------------------------------------------------------------
// 5. TypeScript Compilation Check (Pre-Push & Full Scan)
// ----------------------------------------------------------------------------
if (isFullScan) {
  console.log('\n[5/5] Running TypeScript compiler verification (tsc --noEmit)...');
  try {
    execSync('npx tsc --noEmit', { stdio: 'inherit' });
    logPass('TypeScript build verification passed with zero errors.');
  } catch (tsErr) {
    logFail('TypeScript compilation failed. Fix type errors before redeploying to Cloud Run.');
  }
} else {
  console.log('\n[5/5] Skipping full tsc check in fast staged mode. (Run with --full to include)');
}

// ----------------------------------------------------------------------------
// Final Summary & Exit
// ----------------------------------------------------------------------------
console.log('\n======================================================');
if (failures === 0) {
  console.log('🎉 ALL SECURITY & PRE-DEPLOYMENT CHECKS PASSED!');
  console.log('   Safe to commit and deploy to Google Cloud Run.');
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.error(`🛑 BLOCKED: ${failures} security check(s) failed.`);
  console.error('   Please resolve the issues above before proceeding with deployment.');
  console.error('======================================================\n');
  process.exit(1);
}
