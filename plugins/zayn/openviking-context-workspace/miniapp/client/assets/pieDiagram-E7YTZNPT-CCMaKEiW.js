import{p as at}from"./chunk-JWPE2WC7-B-b_RriD.js";import{J as P,g as rt,s as nt,a as it,b as ot,q as st,p as lt,_ as g,l as B,c as ct,D as ut,G as dt,a1 as gt,d as pt,r as ht,E as ft}from"./mermaid-diagram-p0gOuy5R.js";import{p as mt}from"./cynefin-OW5HDTMX-CZKhuGYG.js";import{d as X}from"./arc-DbXDfXQj.js";import{o as vt}from"./ordinal-DILIJJjt.js";import{c as T,b as xt}from"./string-Dn2m9tPN.js";import"./index-CrpXeiZm.js";import"./init-Dmth1JHB.js";function St(t,n){return n<t?-1:n>t?1:n>=t?0:NaN}function yt(t){return t}function wt(){var t=yt,n=St,y=null,b=T(0),l=T(P),p=T(0);function i(e){var r,s=(e=xt(e)).length,h,w,$=0,f=new Array(s),o=new Array(s),D=+b.apply(this,arguments),z=Math.min(P,Math.max(-P,l.apply(this,arguments)-D)),k,L=Math.min(Math.abs(z)/s,p.apply(this,arguments)),u=L*(z<0?-1:1),A;for(r=0;r<s;++r)(A=o[f[r]=r]=+t(e[r],r,e))>0&&($+=A);for(n!=null?f.sort(function(M,m){return n(o[M],o[m])}):y!=null&&f.sort(function(M,m){return y(e[M],e[m])}),r=0,w=$?(z-s*u)/$:0;r<s;++r,D=k)h=f[r],A=o[h],k=D+(A>0?A*w:0)+u,o[h]={data:e[h],index:r,value:A,startAngle:D,endAngle:k,padAngle:L};return o}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:T(+e),i):t},i.sortValues=function(e){return arguments.length?(n=e,y=null,i):n},i.sort=function(e){return arguments.length?(y=e,n=null,i):y},i.startAngle=function(e){return arguments.length?(b=typeof e=="function"?e:T(+e),i):b},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:T(+e),i):l},i.padAngle=function(e){return arguments.length?(p=typeof e=="function"?e:T(+e),i):p},i}var At=ft.pie,I={sections:new Map,showData:!1},F=I.sections,V=I.showData,Ct=structuredClone(At),$t=g(()=>structuredClone(Ct),"getConfig"),Dt=g(()=>{F=new Map,V=I.showData,ht()},"clear"),Tt=g(({label:t,value:n})=>{if(n<0)throw new Error(`"${t}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);F.has(t)||(F.set(t,n),B.debug(`added new section: ${t}, with value: ${n}`))},"addSection"),bt=g(()=>F,"getSections"),kt=g(t=>{V=t},"setShowData"),Et=g(()=>V,"getShowData"),Z={getConfig:$t,clear:Dt,setDiagramTitle:lt,getDiagramTitle:st,setAccTitle:ot,getAccTitle:it,setAccDescription:nt,getAccDescription:rt,addSection:Tt,getSections:bt,setShowData:kt,getShowData:Et},zt=g((t,n)=>{at(t,n),n.setShowData(t.showData),t.sections.map(n.addSection)},"populateDb"),Mt={parse:g(async t=>{const n=await mt("pie",t);B.debug(n),zt(n,Z)},"parse")},Rt=g(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),Lt=Rt,Wt=g(t=>{const n=[...t.values()].reduce((l,p)=>l+p,0),y=[...t.entries()].map(([l,p])=>({label:l,value:p})).filter(l=>l.value/n*100>=1);return wt().value(l=>l.value).sort(null)(y)},"createPieArcs"),_t=g((t,n,y,b)=>{B.debug(`rendering pie chart
`+t);const l=b.db,p=ct(),i=ut(l.getConfig(),p.pie),e=40,r=18,s=4,h=450,w=h,$=dt(n),f=$.append("g");f.attr("transform","translate("+w/2+","+h/2+")");const{themeVariables:o}=p;let[D]=gt(o.pieOuterStrokeWidth);D??=2;const z=i.legendPosition,k=i.textPosition,L=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,u=Math.min(w,h)/2-e,A=X().innerRadius(L*u).outerRadius(u),M=X().innerRadius(u*k).outerRadius(u*k),m=f.append("g");m.append("circle").attr("cx",0).attr("cy",0).attr("r",u+D/2).attr("class","pieOuterCircle");const W=l.getSections(),K=Wt(W),Q=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12];let G=0;W.forEach(a=>{G+=a});const U=K.filter(a=>(a.data.value/G*100).toFixed(0)!=="0"),H=vt(Q).domain([...W.keys()]);m.selectAll("mySlices").data(U).enter().append("path").attr("d",A).attr("fill",a=>H(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),m.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/G*100).toFixed(0)+"%").attr("transform",a=>"translate("+M.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const Y=f.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),R=[...W.entries()].map(([a,c])=>({label:a,value:c})),C=f.selectAll(".legend").data(R).enter().append("g").attr("class","legend");C.append("rect").attr("width",r).attr("height",r).style("fill",a=>H(a.label)).style("stroke",a=>H(a.label)),C.append("text").attr("x",r+s).attr("y",r-s).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const E=Math.max(...C.selectAll("text").nodes().map(a=>a?.getBoundingClientRect().width??0));let _=h,N=w+e;const d=r+s,O=R.length*d;switch(z){case"center":C.attr("transform",(a,c)=>{const v=d*R.length/2,x=-E/2-(r+s),S=c*d-v;return"translate("+x+","+S+")"});break;case"top":_+=O,C.attr("transform",(a,c)=>{const v=u,x=-E/2-(r+s),S=c*d-v;return`translate(${x}, ${S})`}),m.attr("transform",()=>`translate(0, ${O+d})`);break;case"bottom":_+=O,C.attr("transform",(a,c)=>{const v=-u-d,x=-E/2-(r+s),S=c*d-v;return"translate("+x+","+S+")"});break;case"left":N+=r+s+E,C.attr("transform",(a,c)=>{const v=d*R.length/2,x=-u-(r+s),S=c*d-v;return"translate("+x+","+S+")"}),m.attr("transform",()=>`translate(${E+r+s}, 0)`);break;default:N+=r+s+E,C.attr("transform",(a,c)=>{const v=d*R.length/2,x=12*r,S=c*d-v;return"translate("+x+","+S+")"});break}const j=Y.node()?.getBoundingClientRect().width??0,tt=w/2-j/2,et=w/2+j/2,q=Math.min(0,tt),J=Math.max(N,et)-q;$.attr("viewBox",`${q} 0 ${J} ${_}`),pt($,_,J,i.useMaxWidth)},"draw"),Ft={draw:_t},jt={parser:Mt,db:Z,renderer:Ft,styles:Lt};export{jt as diagram};
