import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
it('names the English Padisarah system while preserving internal identifiers',()=>{
  expect(source).toContain('PROJECTZERO');expect(source).toContain('<strong class="system-brand">Padisarah</strong>');
  expect(source).toContain('Padisarah · your independent-unit control system.');expect(source).toContain('PADISARAH · UNIT ORDER');
  expect(readFileSync(new URL('../index.html',import.meta.url),'utf8')).toContain('<title>ProjectZero · First Playable</title>');
});
it('uses scoped identity tokens without recolouring semantic feedback',()=>{
  expect(css).toContain('--system-accent:#CBB7F4;--system-ink:#F5F1FA');
  for(const rule of ['.crosshair.firing{border-color:#ffc77c;box-shadow:0 0 14px #ffb65d}',
    'progress{height:4px;width:100%;accent-color:#ead292}',
    'button:focus-visible,a:focus-visible{outline:3px solid #e8c473;outline-offset:3px}',
    '#tracking-state{font-size:10px;letter-spacing:1.3px;color:#abd9cd}',
    '.privacy i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8bd5c0;margin-right:8px}'])expect(css).toContain(rule);
  const tokenRules=css.split('}').filter(rule=>rule.includes('var(--system-'));
  expect(tokenRules).toHaveLength(6);expect(tokenRules.join('}')).not.toMatch(/tracking|firing|warning|progress|focus|synthetic/);
});
function luminance(hex:string){const rgb=hex.match(/\w\w/g)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
it('new text/background pairs exceed 4.5:1 contrast without relying on colour alone',()=>{
  for(const [foreground,background] of [['CBB7F4','09131c'],['F5F1FA','09131c'],['10282b','CBB7F4'],['10282b','F5F1FA'],['CBB7F4','102430']]){
    const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);expect((values[0]+.05)/(values[1]+.05)).toBeGreaterThanOrEqual(4.5);
  }
});
