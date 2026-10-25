import {validateTemplate} from './core.mjs';

function indexes(values,count){
  if(!Array.isArray(values)||values.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('自動配置する行・列の選択を確認してください。');
  return [...new Set(values)].sort((a,b)=>a-b);
}
// 長い暗色線・青線の投影を使う。文字の短い筆画は境界に数えない。
function projection(image,vertical,range,across){
  const {width:w,height:h,data}=image,depth=vertical?w:h,start=Math.max(0,Math.floor(range[0])),end=Math.min(depth-1,Math.ceil(range[1]));
  const from=Math.max(0,Math.floor(across[0])),to=Math.min(vertical?h:w,Math.ceil(across[1])),counts=[];
  for(let pos=start;pos<=end;pos++){
    let hits=0;
    for(let a=from;a<to;a++){
      const i=(vertical?a*w+pos:pos*w+a)*4,alpha=data[i+3]/255,r=data[i]*alpha+255*(1-alpha),g=data[i+1]*alpha+255*(1-alpha),b=data[i+2]*alpha+255*(1-alpha),lum=.299*r+.587*g+.114*b;
      if(lum<200||b>r+10&&b>g-12&&lum<245)hits++;
    }
    counts.push(hits/Math.max(1,to-from));
  }
  const candidates=[];
  for(let i=0;i<counts.length;i++)if(counts[i]>=.52){
    let sum=0,weight=0,j=i;
    while(j<counts.length&&counts[j]>=.52){sum+=(start+j)*counts[j];weight+=counts[j];j++;}
    let pos=Math.round(sum/weight);if(pos===depth-1)pos=depth;
    candidates.push(pos);i=j-1;
  }
  return candidates;
}
// 昇順の候補への最小移動割当。候補が余っても既存の境界数は変えない。
function assign(targets,candidates,label){
  if(candidates.length<targets.length)throw Error(`${label}の境界候補が不足しています。手動で調整するか、検出範囲を広げてください。`);
  const n=targets.length,m=candidates.length,dp=Array.from({length:n+1},()=>Array(m+1).fill(Infinity)),used=Array.from({length:n+1},()=>Array(m+1).fill(false));dp[0].fill(0);
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
    const cost=dp[i-1][j-1]+(targets[i-1]-candidates[j-1])**2;
    if(cost<dp[i][j-1]){dp[i][j]=cost;used[i][j]=true;}else dp[i][j]=dp[i][j-1];
  }
  const result=Array(n);let i=n,j=m;while(i){if(used[i][j]){result[--i]=candidates[--j];}else j--;}
  return result;
}
export function autoPlaceGrid(input,image,options={}){
  const t=validateTemplate(input),[w,h]=t.size,{scope='selection',axis='both'}=options;
  if(!['selection','all'].includes(scope)||!['rows','columns','both'].includes(axis))throw Error('自動配置の対象範囲と行・列を指定してください。');
  if(!image||image.width!==w||image.height!==h||image.data?.length!==w*h*4)throw Error('表の補正サイズと検出用画像のサイズが一致しません。');
  const rows=scope==='all'?Array.from({length:t.row_edges.length-1},(_,i)=>i):indexes(options.rows??[],t.row_edges.length-1),columns=scope==='all'?t.columns.map((_,i)=>i):indexes(options.columns??[],t.columns.length);
  const doRows=axis!=='columns',doColumns=axis!=='rows';
  if(doRows&&!rows.length||doColumns&&!columns.length)throw Error('自動配置する行・列を選択してください。');
  const xRange=columns.length?[Math.min(...columns.map(i=>t.columns[i].x[0])),Math.max(...columns.map(i=>t.columns[i].x[1]))]:[0,w];
  const yRange=rows.length?[t.row_edges[rows[0]],t.row_edges[rows.at(-1)+1]]:[0,h];
  if(doRows){
    const selected=new Set(rows),editable=t.row_edges.map((_,i)=>i).filter(i=>(i===0||selected.has(i-1))&&(i===t.row_edges.length-1||selected.has(i)));
    // 選択外の行と共有する外端は固定する。
    for(const index of editable){
      const left=editable.indexOf(index),last=editable[left-1];
      if(last===index-1)continue;
      const group=[index];while(editable.includes(group.at(-1)+1))group.push(group.at(-1)+1);
      const first=group[0],end=group.at(-1),lower=first?t.row_edges[first-1]+1:0,upper=end<t.row_edges.length-1?t.row_edges[end+1]-1:h;
      const candidates=projection(image,false,[Math.max(yRange[0],lower),Math.min(yRange[1],upper)],xRange),positions=assign(group.map(i=>t.row_edges[i]),candidates,'行');
      group.forEach((i,j)=>{t.row_edges[i]=positions[j];});
    }
    if(!editable.length)throw Error('選択外の行を保持するため移動できる行境界がありません。隣接する行も選択してください。');
    // 狭くなった選択行だけ余白を縮め、非選択行の切出しは保持する。
    const oldPaddings=t.row_paddings??Array(t.row_edges.length-1).fill(t.row_padding);
    const paddings=t.row_edges.slice(1).map((end,i)=>selected.has(i)?Math.min(oldPaddings[i],Math.floor((end-t.row_edges[i]-1)/2)):oldPaddings[i]);
    if(paddings.some((v,i)=>v!==oldPaddings[i]))t.row_paddings=paddings;
  }
  if(doColumns){
    const targets=[...new Set(columns.flatMap(i=>t.columns[i].x))].sort((a,b)=>a-b),candidates=projection(image,true,xRange,yRange),positions=assign(targets,candidates,'列'),mapping=new Map(targets.map((v,i)=>[v,positions[i]]));
    for(const i of columns){const c=t.columns[i];c.x=c.x.map(x=>mapping.get(x));c.x1=c.x[0]/w;c.x2=c.x[1]/w;}
  }
  return validateTemplate(t);
}
