import fs from 'fs';
const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');
// Line 478 is index 477. We want to insert AFTER the </h4> which is line 481 (index 480).
// Let's find the exact index where we want to insert.
const headingIndex = lines.findIndex(l => l.includes('تخصيص عدوانية الوحش'));

if (headingIndex !== -1) {
    // Find the end of the h4 block
    let insertIndex = headingIndex + 1;
    while (insertIndex < lines.length && !lines[insertIndex].includes('</h4>')) {
        insertIndex++;
    }
    insertIndex++; // Move past </h4>

    const toggleCode = [
        '                          <label className="flex items-start gap-4 cursor-pointer p-4 bg-black/40 border-2 border-rose-600 hover:border-rose-400 transition-all rounded-lg group animate-pulse mb-6">',
        '                            <div className="relative flex items-start pt-1">',
        '                               <input ',
        '                                 type="checkbox"',
        '                                 checked={(settings as any).isNightmareMode || false}',
        '                                 onChange={e => setSettings({...settings, isNightmareMode: e.target.checked} as any)}',
        '                                 className="w-6 h-6 accent-rose-600 bg-slate-900 border-rose-700 rounded cursor-pointer"',
        '                               />',
        '                            </div>',
        '                            <div>',
        '                               <span className="block text-rose-500 font-black text-lg mb-1 group-hover:text-rose-400 transition-colors">🩸 وضع الكابوس الـ4.2 (Nightmare Mode)</span>',
        '                               <span className="text-xs text-rose-200/70 block leading-relaxed">',
        '                                  <b>تحذير:</b> هذا الوضع يلغي جميع ضوابط الأمان العادية لتحقيق أقصى ربحية هجومية.',
        '                               </span>',
        '                            </div>',
        '                          </label>',
        ''
    ];

    lines.splice(insertIndex, 0, ...toggleCode);
    fs.writeFileSync('src/App.tsx', lines.join('\n'));
    console.log('Nightmare mode added correctly.');
} else {
    console.log('Heading not found.');
}
