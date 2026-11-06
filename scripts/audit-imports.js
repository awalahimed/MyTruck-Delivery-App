/**
 * Audit script: find files that CALL onSnapshot but don't import it from firebase/firestore
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["screens", "components", "contexts", "features", "navigation"];
const FIRESTORE_FUNCS = ["onSnapshot", "getDocs", "getDoc", "updateDoc", "deleteDoc", "setDoc", "addDoc", "writeBatch", "query", "where", "collection", "doc", "serverTimestamp"];

let issues = 0;

for (const dir of DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;
  
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".js") || f.endsWith(".jsx"));
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const content = fs.readFileSync(filePath, "utf8");
    
    // Find firebase/firestore import
    const importMatch = content.match(/import\s*\{([^}]+)\}\s*from\s*["']firebase\/firestore["']/);
    const importedFuncs = importMatch ? importMatch[1].split(",").map(s => s.trim()).filter(Boolean) : [];
    
    // Check each firestore function usage
    for (const fn of FIRESTORE_FUNCS) {
      const usedInCode = new RegExp(`\\b${fn}\\s*\\(`).test(content);
      const isImported = importedFuncs.includes(fn);
      
      if (usedInCode && !isImported) {
        console.log(`❌ MISSING IMPORT: ${fn} used but not imported in ${dir}/${file}`);
        issues++;
      }
    }
  }
}

if (issues === 0) {
  console.log("✅ All Firestore function imports are correct across all files.");
} else {
  console.log(`\n⚠️  Total missing imports: ${issues}`);
}

