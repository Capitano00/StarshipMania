/**
 * Voice command benchmark: runs a fixed, labelled phrase list through a parser and scores it.
 * By default it measures parseVoiceCommand in src/voice.ts. A voice agent that produces VoiceIntents another way can be
 * measured with the same list by passing its own function to evaluateVoice.
 */
import {parseVoiceCommand,type VoiceIntent} from '../voice';

type Expected=VoiceIntent|null;
/** Each phrase and the intent a careful listener would take from it. null = not a command; ignore it. */
export const phrases:{text:string;expected:Expected;kind:'clear'|'misheard'|'not a command'}[]=[
  {text:'recall',expected:{kind:'recall'},kind:'clear'},
  {text:'come back',expected:{kind:'recall'},kind:'clear'},
  {text:'return',expected:{kind:'recall'},kind:'clear'},
  {text:'units recall now',expected:{kind:'recall'},kind:'clear'},
  {text:'deploy T3',expected:{kind:'deploy',targetId:'T3'},kind:'clear'},
  {text:'deploy t1',expected:{kind:'deploy',targetId:'T1'},kind:'clear'},
  {text:'attack tee three',expected:{kind:'deploy',targetId:'T3'},kind:'misheard'},
  {text:'go 3',expected:{kind:'deploy',targetId:'T3'},kind:'clear'},
  {text:'deploy tea two',expected:{kind:'deploy',targetId:'T2'},kind:'misheard'},
  {text:'attack T5',expected:{kind:'deploy',targetId:'T5'},kind:'clear'},
  {text:'deploy T free',expected:{kind:'deploy',targetId:'T3'},kind:'misheard'},
  {text:'fire at will',expected:{kind:'fireAtWill',enabled:true},kind:'clear'},
  {text:'fire at will off',expected:{kind:'fireAtWill',enabled:false},kind:'clear'},
  {text:'fire at will policy B',expected:{kind:'fireAtWill',enabled:true,mode:'B'},kind:'clear'},
  {text:'uh what',expected:null,kind:'not a command'},
  {text:'nice shot',expected:null,kind:'not a command'},
  {text:'where is the third one',expected:null,kind:'not a command'},
  {text:'deploy',expected:null,kind:'not a command'},
];

const same=(a:Expected,b:Expected)=>JSON.stringify(a)===JSON.stringify(b);
export type Outcome='correct'|'wrong order'|'missed'|'false trigger';

export function evaluateVoice(parse:(text:string)=>VoiceIntent|null=parseVoiceCommand){
  const results=phrases.map(p=>{
    let got:Expected=null;const started=performance.now();
    try{got=parse(p.text);}catch{got=null;}
    const ms=performance.now()-started;
    const outcome:Outcome=same(got,p.expected)?'correct':p.expected===null?'false trigger':got===null?'missed':'wrong order';
    return {...p,got,outcome,ms};
  });
  const count=(outcome:Outcome)=>results.filter(r=>r.outcome===outcome).length;
  const byKind=(['clear','misheard','not a command'] as const).map(kind=>{const group=results.filter(r=>r.kind===kind);return {kind,phrases:group.length,correct:group.filter(r=>r.outcome==='correct').length};});
  return {
    phrases:results.length,
    accuracy:Math.round(count('correct')/results.length*1000)/10,
    correct:count('correct'),wrongOrders:count('wrong order'),missed:count('missed'),falseTriggers:count('false trigger'),
    byKind,
    /** Parser time only, not speech-to-text. Median per phrase, in milliseconds. */
    medianParseMs:Math.round([...results.map(r=>r.ms)].sort((a,b)=>a-b)[Math.floor(results.length/2)]*1000)/1000,
  };
}
