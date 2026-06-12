import fs from 'fs';

const filepath = 'src/components/TawleefaBuilder.tsx';
let content = fs.readFileSync(filepath, 'utf8');

content = content.replace(/longExitGate:\s*["']AND["']/g, "longExitGate: 'OR'");
content = content.replace(/shortExitGate:\s*["']AND["']/g, "shortExitGate: 'OR'");
content = content.replace(/exitGate:\s*["']AND["']/g, "exitGate: 'OR'");

fs.writeFileSync(filepath, content, 'utf8');
console.log("Exits updated to OR.");
