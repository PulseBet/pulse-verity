import fs from "node:fs";

const files = ["src/index.ts", "README.md", "server.json", "package.json"];
const banned = /\b(bet|bets|betting|wager|wagers|wagered|wagering|gamble|gambles|gambling|gambler|casino|casinos|odds|punt|punts|bookie|bookies|jackpot|jackpots|stake|stakes|staked|staking)\b/i;

const failures = [];
for (const file of files) {
  const lines = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (banned.test(line)) failures.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (failures.length) {
  console.error(`Pulse WORDS gate failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`✓ Pulse WORDS gate: ${files.length} public/emittable surfaces clean`);
