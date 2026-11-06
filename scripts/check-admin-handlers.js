const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const code = fs.readFileSync("screens/AdminDashboard.js", "utf8");

const ast = parser.parse(code, {
  sourceType: "module",
  plugins: ["jsx"]
});

const declared = new Set();
const calledInOnPress = new Set();

traverse(ast, {
  VariableDeclarator(path) {
    if (path.node.id.name) declared.add(path.node.id.name);
  },
  FunctionDeclaration(path) {
    if (path.node.id.name) declared.add(path.node.id.name);
  },
  JSXAttribute(path) {
    if (path.node.name.name === "onPress" || path.node.name.name === "onChangeText" || path.node.name.name === "onValueChange") {
      path.traverse({
        CallExpression(cPath) {
          if (cPath.node.callee.name) {
            calledInOnPress.add({ name: cPath.node.callee.name, line: cPath.node.loc?.start?.line });
          }
        }
      });
    }
  }
});

const builtin = new Set(["alert", "console", "Boolean", "String", "Number", "Math", "Date", "setTimeout", "clearTimeout"]);

let missing = 0;
for (const item of calledInOnPress) {
  if (!declared.has(item.name) && !builtin.has(item.name)) {
    console.log(`❌ Undefined handler called in JSX: "${item.name}" at line ${item.line}`);
    missing++;
  }
}

if (missing === 0) {
  console.log("✅ All handlers called in JSX are declared and valid!");
}

