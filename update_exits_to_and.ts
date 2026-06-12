import fs from 'fs';

const filepath = 'src/components/TawleefaBuilder.tsx';
let content = fs.readFileSync(filepath, 'utf8');

content = content.replace(/longExitGate:\s*["']OR["']/g, "longExitGate: 'AND'");
content = content.replace(/shortExitGate:\s*["']OR["']/g, "shortExitGate: 'AND'");
content = content.replace(/exitGate:\s*["']OR["']/g, "exitGate: 'AND'");

fs.writeFileSync(filepath, content, 'utf8');
console.log("Exits updated to AND.");
