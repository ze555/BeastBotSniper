import fs from 'fs';
const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');
// Delete around lines 590-606 where the wrong Nightmare toggle was placed
// Looking at the view_file output, we need to be careful with indexing.
// Line 590 is index 589.
lines.splice(589, 17); // Remove 17 lines
fs.writeFileSync('src/App.tsx', lines.join('\n'));
console.log('App.tsx fixed.');
