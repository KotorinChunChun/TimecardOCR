import {canvas,prepareCrop,regionColor} from './imaging.mjs';
import {wholeAtlasLayout,atlasBackgrounds} from './page-layout.mjs';
export const ATLAS_REVISION='card-header-neighbor-color-v3';
export function buildWholeAtlas(source,original,regions,{cardImage}={}){
  const regionSource=r=>{if(r.source==='card_image'){if(!cardImage)throw Error('カード情報を結合するには補正済みカード画像が必要です。');return cardImage;}return r.source==='original_image'?original:source;};
  // カード画像が無い場合は、別の座標基準の画像を代用しない。
  for(const r of regions)regionSource(r);
  const layout=wholeAtlasLayout(regions),image=canvas(layout.width,layout.height),ctx=image.getContext('2d'),byId=new Map(regions.map(r=>[r.id,r])),colors=new Map(regions.map(r=>[r.id,regionColor(regionSource(r),r)])),backgrounds=atlasBackgrounds(layout,colors);
  for(const fill of backgrounds){ctx.fillStyle=`rgb(${fill.color.join(',')})`;ctx.fillRect(fill.x,fill.y,fill.width,fill.height);}
  // 切出しは等倍。列に指定した色除去を反映し、原色を保持して余白と隣接背景を足す。
  for(const slot of layout.slots){const r=byId.get(slot.id),tile=prepareCrop(regionSource(r),r,{paddingColor:colors.get(slot.id)});ctx.drawImage(tile,slot.x,slot.y);tile.width=tile.height=1;}
  return {image,layout,backgrounds};
}
