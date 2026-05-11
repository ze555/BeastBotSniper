import fs from 'fs';
const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

// Find the line with smartTimeDecayMinutes input
const targetIndex = lines.findIndex(l => l.includes('smartTimeDecayMinutes: parseInt(e.target.value)} as any)'));

if (targetIndex !== -1) {
    // Add /> to the end of the line
    lines[targetIndex] = lines[targetIndex] + ' />';
    fs.writeFileSync('src/App.tsx', lines.join('\n'));
    console.log('Syntax error fixed.');
} else {
    console.log('Line not found.');
}
