import fs from 'fs';

const filepath = 'src/components/TawleefaBuilder.tsx';
let content = fs.readFileSync(filepath, 'utf8');

content = content.replace(/longExitGate:\s*["']2_OF_3["']/g, "longExitGate: 'AND'");
content = content.replace(/shortExitGate:\s*["']2_OF_3["']/g, "shortExitGate: 'AND'");

fs.writeFileSync(filepath, content, 'utf8');
console.log("Exits updated to AND.");
