const fs = require('fs');
let code = fs.readFileSync('src/components/PredatorDashboard.tsx', 'utf8');

code = code.replace(
  'const [slAtrMultiplier, setSlAtrMultiplier] = useState(\'1.5\');',
  'const [slAtrMultiplier, setSlAtrMultiplier] = useState(\'1.5\');\n  const [geniusMode, setGeniusMode] = useState(true);'
);

code = code.replace(
  'if (data.slAtrMultiplier !== undefined) setSlAtrMultiplier(data.slAtrMultiplier.toString());',
  'if (data.slAtrMultiplier !== undefined) setSlAtrMultiplier(data.slAtrMultiplier.toString());\n            if (data.geniusMode !== undefined) setGeniusMode(data.geniusMode);'
);

code = code.replace(
  'slAtrMultiplier: Number(slAtrMultiplier),',
  'slAtrMultiplier: Number(slAtrMultiplier),\n                  geniusMode,'
);

// We'll add the genius mode checkbox before the Schedule configuration.
const insertPos = code.indexOf('<div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 mt-2">');
// Wait, there are multiple. Let's find the slAtrMultiplier div.
const searchStr = '<label className="text-sm text-slate-200 font-bold block mb-1">مضاعف الـ ATR لوقف الخسارة (SL ATR Multiplier)</label>';
const slAtrDivPos = code.indexOf(searchStr);
if (slAtrDivPos === -1) {
    console.log("Could not find SL ATR div");
} else {
    // Find the end of this div, or just insert before it.
    // Let's insert the genius mode toggle right before SL ATR Multiplier.
    
    // Find the enclosing div:
    const divStart = code.lastIndexOf('<div', slAtrDivPos);
    
    const geniusUI = `
                 <div className="bg-slate-950 p-4 rounded-xl border border-blue-500/50 mt-2 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
                    <label className="flex items-start sm:items-center gap-3 cursor-pointer">
                        <input 
                           type="checkbox" 
                           checked={geniusMode}
                           onChange={(e) => setGeniusMode(e.target.checked)}
                           className="w-5 h-5 mt-1 sm:mt-0 accent-blue-500 shrink-0 bg-slate-800 border-slate-700 rounded focus:ring-blue-500" 
                        />
                        <div>
                           <span className="text-sm text-blue-400 font-bold block mb-1">🤖 وضع العبقرية (Genius Mode)</span>
                           <span className="text-[11px] text-slate-400 block leading-relaxed">
                               يحد من الصفقات الخاسرة برفع معايير الدخول (فقط 🥈 أو 💎)، يسرّع تأمين الصفقة (Breakeven) عند 0.6R بدلاً من 1R، ويفلتر الأسواق المتقلبة.
                           </span>
                        </div>
                    </label>
                 </div>
`;
    code = code.slice(0, divStart) + geniusUI + code.slice(divStart);
    fs.writeFileSync('src/components/PredatorDashboard.tsx', code);
    console.log("Patched UI");
}

