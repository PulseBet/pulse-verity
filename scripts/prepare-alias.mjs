import fs from "node:fs";
import path from "node:path";

const [name, output] = process.argv.slice(2);
const allowed = new Set([
  "pulse-verity-index",
  "pulseverityindex",
  "pulseverity",
  "pulse-index",
  "pulseindex"
]);

if (!allowed.has(name) || !output) {
  throw new Error("Usage: node scripts/prepare-alias.mjs <approved-alias> <output-directory>");
}

fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, "dist"), { recursive: true });
fs.copyFileSync("dist/index.js", path.join(output, "dist", "index.js"));
for (const file of ["LICENSE", "SECURITY.md"]) fs.copyFileSync(file, path.join(output, file));

const canonical = JSON.parse(fs.readFileSync("package.json", "utf8"));
canonical.name = name;
canonical.description = `Functional install alias for the Pulse Verity Index MCP server. Canonical package: pulse-verity`;
canonical.bin = { [name]: "dist/index.js" };
canonical.files = ["dist/index.js", "README.md", "LICENSE", "SECURITY.md"];
canonical.scripts = {};
delete canonical.devDependencies;
fs.writeFileSync(path.join(output, "package.json"), `${JSON.stringify(canonical, null, 2)}\n`);
fs.writeFileSync(path.join(output, "README.md"), `# ${name}\n\nThis is a functional install alias for the **Pulse Verity Index** MCP server.\n\nUse the canonical package for new integrations:\n\n\`\`\`bash\nnpx -y pulse-verity\n\`\`\`\n\nThis alias runs the same read-only tools as \`pulse-verity\`.\n`);
