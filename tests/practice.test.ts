import {it,expect} from 'vitest';
import {PracticeFeedback,PracticeFireFeedback} from '../src/practice';
import type {Hand} from '../src/controls';
it('practice commitment survives idle frames for a readable two-second interval',()=>{const p=new PracticeFeedback();p.commit('T2',100);for(let now=100;now<2100;now+=16)expect(p.text(now,'MOVE 0, 0')).toBe('Practice committed T2');expect(p.text(2100,'MOVE 0, 0')).toBe('MOVE 0, 0');});
it('cancellation cannot produce or retain a practice success',()=>{const p=new PracticeFeedback();p.clear();expect(p.text(0,'idle')).toBe('idle');p.commit('T1',10);p.clear();expect(p.text(20,'idle')).toBe('idle');});
const right=(pinch=1):Hand=>({side:'Right',palm:{x:.7,y:.5},gesture:{category:pinch===.2?'Closed_Fist':'Open_Palm',score:1},confidence:1});
it('recall practice acknowledgement persists across frames, expires, and clears explicitly without simulated recall',()=>{
 const p=new PracticeFeedback();p.recall(100);expect(p.text(116,'MOVE')).toBe('Recall input confirmed - practice only');expect(p.text(2099,'MOVE')).toContain('Recall input confirmed');expect(p.text(2100,'MOVE')).toBe('MOVE');p.recall(2200);p.clear();expect(p.text(2220,'MOVE')).toBe('MOVE');
});
it('practice trigger has independent persistent ready, held and observed-open stopped states',()=>{
 const fire=new PracticeFireFeedback(),funnel=new PracticeFeedback();expect(fire.text(false,right(),'')).toContain('Ready');
 expect(fire.text(true,right(.2),'')).toContain('Fire input held');funnel.commit('T1',0);expect(fire.text(true,right(.2),'')).toContain('Fire input held');
 expect(fire.text(false,right(.65),'')).toContain('Stopped');expect(fire.text(false,right(.66),'')).toContain('Stopped');
 for(let i=0;i<100;i++)expect(fire.text(false,right(),'')).toContain('Stopped');expect(funnel.text(100,'')).toBe('Practice committed T1');
 expect(fire.text(true,right(.2),'')).toContain('Fire input held');
});
it.each(['paused','tracking recovery','camera off','page backgrounded','graphics not ready','waiting for fresh tracking'])('blocked %s is never a release acknowledgement',reason=>{
 const f=new PracticeFireFeedback();f.text(true,right(.2),'');expect(f.text(false,right(),reason)).toBe('Blocked · '+reason);
 expect(f.text(false,right(),'')).toContain('Ready');expect(f.text(false,undefined,'')).toContain('Blocked');
});
