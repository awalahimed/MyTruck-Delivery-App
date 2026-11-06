const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["screens", "components", "contexts", "features", "navigation"];
const HOOKS = ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useLayoutEffect", "useImperativeHandle"];

let totalErrors = 0;

for (const dir of DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".js") || f.endsWith(".jsx"));

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const content = fs.readFileSync(filePath, "utf8");

    // Match React import
    const reactImportMatch = content.match(/import\s+(?:React\s*,?\s*)?(?:\{([^}]+)\})?\s*from\s*["']react["']/);
    const importedHooks = reactImportMatch && reactImportMatch[1]
      ? reactImportMatch[1].split(",").map(h => h.trim()).filter(Boolean)
      : [];

    for (const hook of HOOKS) {
      const isUsed = new RegExp(`\\b${hook}\\s*\\(`).test(content);
      const isImported = importedHooks.includes(hook);

      if (isUsed && !isImported) {
        console.log(`❌ ${hook} used but NOT imported from "react" in ${dir}/${file}`);
        totalErrors++;
      }
    }
  }
}

if (totalErrors === 0) {
  console.log("✅ All React hooks are correctly imported across all screens, components, contexts, and navigation!");
} else {
  console.log(`⚠️ Total hook import errors found: ${totalErrors}`);
}

