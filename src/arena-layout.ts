/** World dimensions are shared by movement, routing, projection and the debug map. */
export const arenaBounds={half:27,width:54,mechLimit:25,unitLimit:26,projectileLimit:33,aimLimit:33} as const;
export const placed=(x:number,y:number)=>({x:x*1.5,y:y*1.5});

export type ArenaBounds = {half:number;width:number;mechLimit:number;unitLimit:number;projectileLimit:number;aimLimit:number};
export const carrierBounds: ArenaBounds = {half:36,width:72,mechLimit:34,unitLimit:35,projectileLimit:42,aimLimit:42};
