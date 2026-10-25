import {canvas,prepareCrop,regionColor} from './imaging.mjs';
import {wholeAtlasLayout,atlasBackgrounds} from './page-layout.mjs';
export const ATLAS_REVISION='original-neighbor-color-v2';
export function buildWholeAtlas(source,original,regions){
  const layout=wholeAtlasLayout(regions),image=canvas(layout.width,layout.height),ctx=image.getContext('2d'),byId=new Map(regions.map(r=>[r.id,r])),colors=new Map(regions.map(r=>[r.id,regionColor(r.source==='original_image'?original:source,r)])),backgrounds=atlasBackgrounds(layout,colors);
  for(const fill of backgrounds){ctx.fillStyle=`rgb(${fill.color.join(',')})`;ctx.fillRect(fill.x,fill.y,fill.width,fill.height);}
  // 切出しは等倍の原色。余白と隣接背景以外は変更しない。
  for(const slot of layout.slots){const r=byId.get(slot.id),tile=prepareCrop(r.source==='original_image'?original:source,r,{paddingColor:colors.get(slot.id)});ctx.drawImage(tile,slot.x,slot.y);tile.width=tile.height=1;}
  return {image,layout,backgrounds};
}
