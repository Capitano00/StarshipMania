/** World dimensions are shared by movement, routing, projection and the debug map. */
export const arenaBounds={half:27,width:54,mechLimit:25,unitLimit:26,projectileLimit:33,aimLimit:33} as const;
export const placed=(x:number,y:number)=>({x:x*1.5,y:y*1.5});
