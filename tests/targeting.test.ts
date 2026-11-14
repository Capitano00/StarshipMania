import {it,expect} from 'vitest';
import {nominate,type ProjectedTarget} from '../src/targeting';
const a:ProjectedTarget={id:'T1',left:100,right:140,top:100,bottom:140,visible:true};
it.each([.5,1,2])('uses CSS-pixel halos independent of projected silhouette size (%s)',scale=>{
 const target={...a,right:100+40*scale,bottom:100+40*scale};expect(nominate({x:target.right+24,y:110},[target],null)).toBe('T1');expect(nominate({x:target.right+24.01,y:110},[target],null)).toBeNull();expect(nominate({x:target.right+32,y:110},[target],'T1')).toBe('T1');expect(nominate({x:target.right+32.01,y:110},[target],'T1')).toBeNull();
});
it('clips halos at nearest-neighbour boundaries and rejects ambiguity instead of retaining',()=>{
 const b={...a,id:'T2' as const,left:160,right:200};expect(nominate({x:149,y:120},[a,b],'T2')).toBe('T1');expect(nominate({x:150,y:120},[a,b],'T1')).toBeNull();expect(nominate({x:151,y:120},[a,b],'T1')).toBe('T2');
});
it('a new direct hit wins retention and occluded/destroyed targets cannot nominate',()=>{
 const b={...a,id:'T2' as const,left:150,right:190};expect(nominate({x:155,y:120},[a,b],'T1','T2')).toBe('T2');expect(nominate({x:120,y:120},[{...a,visible:false}],'T1','T1')).toBeNull();expect(nominate({x:120,y:120},[],'T1')).toBeNull();
});
it('nomination never changes the supplied pilot pointer',()=>{const point={x:155,y:120},before={...point};nominate(point,[a],null);expect(point).toEqual(before);});
