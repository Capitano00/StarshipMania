import {describe,it,expect} from 'vitest';
import {TypedTranscriber,describeVoiceIntent,parseVoiceCommand,toVoiceProposal,type Transcript} from '../src/voice';

describe('voice proposals use only existing order shapes',()=>{
 it('maps recall and deploy to plain Orders',()=>{
  expect(toVoiceProposal({kind:'recall'},'A')).toEqual({kind:'order',order:{type:'RECALL'}});
  expect(toVoiceProposal({kind:'deploy',targetId:'T3'},'A')).toEqual({kind:'order',order:{type:'INTERCEPT',targetId:'T3'}});
 });
 it('maps fire at will to a DRONE_POLICY payload, keeping the current policy unless one is named',()=>{
  expect(toVoiceProposal({kind:'fireAtWill',enabled:true},'B')).toEqual({kind:'policy',payload:{type:'DRONE_POLICY',enabled:true,mode:'B'}});
  expect(toVoiceProposal({kind:'fireAtWill',enabled:false,mode:'A'},'B')).toEqual({kind:'policy',payload:{type:'DRONE_POLICY',enabled:false,mode:'A'}});
 });
 it('carries no tick, so stamping stays with the integrator',()=>{
  expect(JSON.stringify(toVoiceProposal({kind:'recall'},'A'))).not.toMatch(/tick/i);
 });
});

describe('typed transcriber',()=>{
 it('delivers non-blank text only while started',()=>{
  const heard:Transcript[]=[],v=new TypedTranscriber();
  v.submit('recall',1);v.start(t=>heard.push(t));v.submit('   ',2);v.submit('recall',3);v.stop();v.submit('recall',4);
  expect(heard).toEqual([{text:'recall',confidence:1,at:3}]);
 });
 it('describes intents for a voice panel',()=>{
  expect(describeVoiceIntent({kind:'fireAtWill',enabled:true,mode:'B'})).toBe('Fire at will on / policy B');
  expect(describeVoiceIntent({kind:'deploy',targetId:'T2'})).toBe('Deploy T2');
 });
});

describe('parseVoiceCommand (yours to implement)',()=>{
 it('returns null for chatter',()=>{expect(parseVoiceCommand('uh what')).toBeNull();});
 // Turn these into real expectations as you implement the parser.
 it.todo('"recall" and "come back" -> {kind:"recall"}');
 it.todo('"deploy T3" and "attack tee three" -> {kind:"deploy",targetId:"T3"}');
 it.todo('"fire at will off" -> {kind:"fireAtWill",enabled:false}');
 it.todo('"fire at will policy B" -> {kind:"fireAtWill",enabled:true,mode:"B"}');
 it.todo('decide what "recall and deploy T2" should return');
});
