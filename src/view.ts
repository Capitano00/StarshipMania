import {arenaBounds} from './arena-layout';
import * as THREE from 'three';
import {actorDefinitions,type Simulation} from './simulation';
import type {TargetId,Vec2} from './contracts';
import {barriers} from './cover';
import {nominate,type ProjectedTarget} from './targeting';
import './target-labels.css';
const metal=(color:number,emissive=0)=>new THREE.MeshStandardMaterial({color,roughness:.6,metalness:.45,emissive,emissiveIntensity:.5});
const box=(w:number,h:number,d:number,color:number,x=0,y=0,z=0)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),metal(color));mesh.position.set(x,y,z);return mesh;};
const ring=(radius:number,width:number,color:number)=>{const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,width,8,40),new THREE.MeshBasicMaterial({color}));mesh.rotation.x=-Math.PI/2;mesh.visible=false;return mesh;};
export class ArenaView {
 readonly renderer:THREE.WebGLRenderer;readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(52,1,.1,200);
 private mech=new THREE.Group();private legs:THREE.Group[]=[];private mechGun:THREE.Mesh;
 private turrets=new Map<TargetId,THREE.Group>();private turretHeads=new Map<TargetId,THREE.Group>();
 private targetLabelLayer = document.createElement('div');
 private targetLabels = new Map<TargetId, HTMLSpanElement>();
 private targetLabelPoint = new THREE.Vector3();
 private visibleLabelTargets = new Set<TargetId>();
 private funnels=new Map<string,THREE.Group>();private unitRings=new Map<string,THREE.Mesh>();private shots=new Map<number,THREE.Mesh>();private walls:THREE.Mesh[]=[];
 private ray=new THREE.Raycaster();private ground=new THREE.Plane(new THREE.Vector3(0,1,0),-1);
 private previewRing=ring(1.65,.055,0xf4d577);private assignedRing=ring(1.9,.12,0xcbb7f4);private aimedRing=ring(1.4,.035,0xf5f1fa);
 private line:THREE.Line;private impact=ring(.5,.06,0xffc77c);private drawnRun='';private candidate:TargetId|null=null;
 constructor(private canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.scene.background=new THREE.Color(0x09131c);this.scene.fog=new THREE.Fog(0x09131c,36,85);
  this.scene.add(new THREE.HemisphereLight(0xc7c4e8,0x172934,2.5));const sun=new THREE.DirectionalLight(0xf5f1fa,3);sun.position.set(-8,18,10);this.scene.add(sun);
  const ground=box(arenaBounds.width,.2,arenaBounds.width,0x12212c,0,-.2,0);this.scene.add(ground);const grid=new THREE.GridHelper(arenaBounds.width,27,0x465061,0x263846);grid.position.y=-.08;this.scene.add(grid);
  for(const x of [-arenaBounds.half,arenaBounds.half])this.scene.add(box(.3,.5,arenaBounds.width,0x344653,x,.1,0));for(const z of [-arenaBounds.half,arenaBounds.half])this.scene.add(box(arenaBounds.width,.5,.3,0x344653,0,.1,z));
  for(const b of barriers){
   const wall=box(b.maxX-b.minX,b.height,b.maxY-b.minY,0x394252,(b.minX+b.maxX)/2,b.height/2,(b.minY+b.maxY)/2);wall.userData.cover=true;this.walls.push(wall);this.scene.add(wall);
   const cap=box(b.maxX-b.minX,.09,b.maxY-b.minY+.04,0xb4a5c8,wall.position.x,b.height+.04,wall.position.z);this.scene.add(cap);
   for(let i=-2;i<=2;i+=2)this.scene.add(box(.09,1.2,.04,0x17232f,wall.position.x+i,.85,wall.position.z+.65));
  }
  this.mech.add(box(1.25,1.35,.85,0xd4d5df,0,1.85,0),box(.92,.35,.95,0x786b96,0,2.55,0),box(.68,.55,.6,0xe4e0eb,0,2.95,-.12),box(.56,.13,.05,0x90dcd1,0,3,-.445));
  this.mech.add(box(.75,.45,.6,0x39465b,0,1.05,0),box(.8,.95,.42,0x625877,0,1.95,.65));
  for(const side of [-1,1]){
   const leg=new THREE.Group();leg.position.set(side*.44,1,0);leg.add(box(.38,.65,.42,0x756787,0,-.2,0),box(.46,.55,.48,0xd4d5df,0,-.72,.04),box(.53,.22,.85,0x424b5c,0,-.93,-.2));this.legs.push(leg);this.mech.add(leg);
   this.mech.add(box(.65,.52,.95,0xb9b1cb,side*.93,2.35,0),box(.38,.72,.4,0x5d536e,side*.99,1.75,0));
   const thruster=new THREE.Mesh(new THREE.ConeGeometry(.17,.5,8),metal(0x90dcd1,0x90dcd1));thruster.position.set(side*.3,1.2,.65);this.mech.add(thruster);
  }
  this.mechGun=box(.32,.36,1.4,0x354e5c,1,1.5,-.7);this.mech.add(this.mechGun);this.scene.add(this.mech);
  for(const actor of actorDefinitions){const {id,armed,position:{x,y:z}}=actor;
   const group=new THREE.Group();group.position.set(x,0,z);group.userData.targetId=id;
   const base=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.4,.5,8),metal(0x4b4352));base.position.y=.25;group.add(base);
   const head=new THREE.Group();head.position.y=.9;head.add(box(1.6,1.1,1.4,armed?0xa17568:0x668f96),box(.95,.18,1.1,armed?0xdeb899:0xcbb7f4,0,.62,0));if(armed)head.add(box(.35,.35,1.5,0x403746,0,.05,1));
   for(const side of [-1,1])head.add(box(.11,.18,.3,0xffc77c,side*.6,.1,.75));group.add(head);this.turretHeads.set(id,head);this.turrets.set(id,group);this.scene.add(group);
   const label = document.createElement('span');
   label.className = 'arena-target-label';
   label.textContent = id;
   label.hidden = true;
   this.targetLabels.set(id, label);
   this.targetLabelLayer.append(label);
  }
  this.targetLabelLayer.className = 'arena-target-labels';
  this.targetLabelLayer.setAttribute('role', 'group');
  this.targetLabelLayer.setAttribute('aria-label', 'Visible arena targets');
  canvas.after(this.targetLabelLayer);
  canvas.addEventListener('webglcontextlost', () => { this.targetLabelLayer.hidden = true; });
  this.line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0xf4d577,dashSize:.45,gapSize:.3}));this.line.visible=false;
  this.scene.add(this.previewRing,this.assignedRing,this.aimedRing,this.line,this.impact);window.addEventListener('resize',()=>this.resize());this.resize();
 }
 private createUnit(id:string){
   const drone=new THREE.Group();drone.add(box(.55,.38,1.35,0xf5f1fa),box(.3,.2,.65,0xcbb7f4,0,.26,-.15));
   for(const side of [-1,1]){const wing=box(.55,.12,.9,0x9481b4,side*.48,0,.18);wing.rotation.z=side*.2;drone.add(wing);}
   drone.add(box(.23,.16,.36,0x90dcd1,0,0,-.83));
   const engine=new THREE.Mesh(new THREE.ConeGeometry(.2,.65,8),metal(0xcbb7f4,0xcbb7f4));engine.rotation.x=Math.PI/2;engine.position.z=.88;drone.add(engine);this.funnels.set(id,drone);const marker=ring(1.9,.08,0xcbb7f4);this.unitRings.set(id,marker);this.scene.add(marker);this.scene.add(drone);
  }
 resize(){const w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 private setCamera(sim:Simulation){this.camera.position.set(sim.position.x,14,sim.position.y+19);this.camera.lookAt(sim.position.x,0,sim.position.y-9);this.camera.updateMatrixWorld();}
 private sync(sim:Simulation){this.mech.position.set(sim.position.x,0,sim.position.y);for(const target of sim.turrets){const mesh=this.turrets.get(target.id)!;mesh.visible=target.health>0;mesh.position.set(target.position.x,0,target.position.y);}this.scene.updateMatrixWorld(true);}
 projectWorld(point:Vec2,sim:Simulation){this.setCamera(sim);const p=new THREE.Vector3(point.x,1,point.y).project(this.camera);return {x:p.x/.88,y:p.y/.72};}
 projectFixtureTarget(id:TargetId,sim:Simulation){return this.projectWorld(sim.turrets.find(t=>t.id===id)!.position,sim);}
 private updateTargetLabels(sim: Simulation, aimed: TargetId | null) {
  this.targetLabelLayer.hidden = false;
  const point = this.targetLabelPoint;
  for (const {id, position, health} of sim.turrets) {
   const label = this.targetLabels.get(id)!;
   // The existing reticle callout already includes the aimed target's ID and status.
   const visible = id !== aimed && health > 0 && this.visibleLabelTargets.has(id);
   if (visible) point.set(position.x, 1.6, position.y).project(this.camera);
   const inFrame = visible && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1;
   label.hidden = !inFrame;
   if (!inFrame) continue;
   label.style.setProperty('--target-x', `${(point.x + 1) * 50}%`);
   label.style.setProperty('--target-y', `${(1 - point.y) * 50}%`);
  }
 }
 aim(pointer:Vec2,sim:Simulation):{point:Vec2;target:TargetId|null}{
  this.setCamera(sim);this.sync(sim);this.ray.setFromCamera(new THREE.Vector2(pointer.x*.88,pointer.y*.72),this.camera);
  const aim=new THREE.Vector3();this.ray.ray.intersectPlane(this.ground,aim);
  const objects=[...this.turrets.values()].filter(t=>t.visible),hits=this.ray.intersectObjects([...objects,...this.walls],true);
  let direct:TargetId|null=null;
  if(hits[0]){let object:THREE.Object3D|null=hits[0].object;while(object&&!object.userData.targetId&&!object.userData.cover)object=object.parent;direct=object?.userData.targetId??null;}
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight,bounds:ProjectedTarget[]=[];
  this.visibleLabelTargets.clear();
  for(const target of sim.turrets)if(target.health>0){
   const mesh=this.turrets.get(target.id)!,box=new THREE.Box3().setFromObject(mesh),points:THREE.Vector3[]=[];
   for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(this.camera));
   const center=new THREE.Vector3(target.position.x,1,target.position.y),delta=center.clone().sub(this.camera.position),distance=delta.length();
   this.ray.set(this.camera.position,delta.normalize());const obstruction=this.ray.intersectObjects(this.walls,false)[0];
   const visible=points.every(p=>p.z>=-1&&p.z<=1)&&(direct===target.id||!obstruction||obstruction.distance>=distance);
   if(visible)this.visibleLabelTargets.add(target.id);
   bounds.push({id:target.id,left:Math.min(...points.map(p=>(p.x+1)*width/2)),right:Math.max(...points.map(p=>(p.x+1)*width/2)),top:Math.min(...points.map(p=>(1-p.y)*height/2)),bottom:Math.max(...points.map(p=>(1-p.y)*height/2)),visible});
  }
  this.candidate=nominate({x:(pointer.x*.88+1)*width/2,y:(1-pointer.y*.72)*height/2},bounds,this.drawnRun===sim.runId?this.candidate:null,direct);
  return {point:{x:Math.max(-arenaBounds.aimLimit,Math.min(arenaBounds.aimLimit,aim.x)),y:Math.max(-arenaBounds.aimLimit,Math.min(arenaBounds.aimLimit,aim.z))},target:this.candidate};
 }
 draw(sim:Simulation,preview:TargetId|null,aim:Vec2,aimed:TargetId|null){
  if(this.drawnRun!==sim.runId){for(const mesh of this.shots.values()){this.scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}this.shots.clear();this.drawnRun=sim.runId;}
  this.setCamera(sim);this.sync(sim);this.mech.rotation.y=Math.atan2(aim.x-sim.position.x,aim.y-sim.position.y)+Math.PI;
  const stride=Math.sin(sim.tick*.2)*.25;this.legs.forEach((leg,i)=>leg.rotation.x=stride*(i?1:-1));this.mechGun.position.z=-.7+(sim.projectiles.some(s=>s.team==='pilot'&&s.life>236)?.1:0);
  for(const turret of sim.turrets){const head=this.turretHeads.get(turret.id)!;head.rotation.y=Math.atan2(sim.position.x-turret.position.x,sim.position.y-turret.position.y);}
  sim.funnels.forEach((f,i)=>{if(!this.funnels.has(f.id))this.createUnit(f.id);const mesh=this.funnels.get(f.id)!;mesh.position.set(f.position.x,1.6+Math.sin(sim.tick*.08+i)*.05,f.position.y);const target=f.order.type==='INTERCEPT'?sim.turrets.find(t=>t.id===(f.order as {targetId:TargetId}).targetId)?.position:f.path[f.waypoint];if(target)mesh.rotation.y=Math.atan2(target.x-f.position.x,target.y-f.position.y)+Math.PI;});
  for(const [id,mesh] of this.funnels){const unit=sim.funnels.find(f=>f.id===id);mesh.visible=!!unit;const marker=this.unitRings.get(id)!;const target=unit?.order.type==='INTERCEPT'?sim.turrets.find(t=>unit.order.type==='INTERCEPT'&&t.id===unit.order.targetId&&t.health>0):undefined;marker.visible=!!target;if(target)marker.position.set(target.position.x,.08,target.position.y);}
  this.mech.scale.setScalar(sim.dash?1.015:1);
  const alive=new Set(sim.projectiles.map(p=>p.id));for(const [id,mesh] of this.shots)if(!alive.has(id)){this.scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();this.shots.delete(id);}
  for(const shot of sim.projectiles){let mesh=this.shots.get(shot.id);if(!mesh){const radius=shot.team==='enemy'?.2:shot.team==='pilot'?.12:.17;mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,8,6),new THREE.MeshBasicMaterial({color:shot.team==='enemy'?0xffb65d:shot.team==='pilot'?0x90dcd1:0xcbb7f4}));this.shots.set(shot.id,mesh);this.scene.add(mesh);}mesh.position.set(shot.position.x,1,shot.position.y);}
  for(const [mesh,id] of [[this.previewRing,preview],[this.aimedRing,aimed],[this.assignedRing,null]] as const){const target=sim.turrets.find(t=>t.id===id&&t.health>0);mesh.visible=!!target;if(target)mesh.position.set(target.position.x,.08,target.position.y);}
  this.line.visible=!!preview;if(preview){const target=sim.turrets.find(t=>t.id===preview)!;this.line.geometry.dispose();this.line.geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sim.position.x,.2,sim.position.y),new THREE.Vector3(target.position.x,.2,target.position.y)]);this.line.computeLineDistances();}
  this.impact.visible=!!sim.lastImpact&&sim.tick-sim.lastImpact.tick<10;if(this.impact.visible){this.impact.position.set(sim.lastImpact!.position.x,1,sim.lastImpact!.position.y);this.impact.scale.setScalar(1+(sim.tick-sim.lastImpact!.tick)*.12);}
  this.renderer.render(this.scene,this.camera);
  this.updateTargetLabels(sim, aimed);
 }
}
