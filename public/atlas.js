import { journeyPoint } from './movement.js';
/** Presentation only: the server decides every movement, battle and ownership change. */
const NS = 'http://www.w3.org/2000/svg';
function node(tag, attributes = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export class Atlas {
  constructor(svg, map, onSelect) {
    this.svg = svg; this.map = map; this.onSelect = onSelect;
    this.positionsById=Object.fromEntries(map.provinces.map(p=>[p.id,{x:p.x,y:p.y}]));
    this.places = new Map(map.provinces.map(p => [p.id, p]));
    this.countries = new Map(map.countries.map(c => [c.id, c]));
    this.view = { x: 0, y: 0, w: 1280, h: 680 };
    this.shapes = new Map(); this.prefix = svg.id === 'map' ? '' : `${svg.id}-`;
    this.markers = new Map(); this.armies = new Map(); this.pointers = new Map();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.replaceChildren();
    const defs = node('defs');
    defs.innerHTML = '<radialGradient id="ocean-light"><stop stop-color="#25434b"/><stop offset="1" stop-color="#102932"/></radialGradient><marker id="march-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#f2d59b"/></marker>';
    defs.innerHTML = defs.innerHTML.replaceAll('ocean-light', `${this.prefix}ocean-light`).replaceAll('march-head', `${this.prefix}march-head`);
    svg.append(defs, node('rect', { x: -1800, y: -1000, width: 4800, height: 3000, fill: `url(#${this.prefix}ocean-light)` }));
    const grid = node('g', { class: 'atlas-grid', 'pointer-events': 'none' });
    for (let x = 0; x <= 1280; x += 105) grid.append(node('path', { d: `M${x},-800V1600` }));
    for (let y = 0; y <= 680; y += 92) grid.append(node('path', { d: `M-1500,${y}H2800` }));
    svg.append(grid);
    const oceans = node('g', { class: 'ocean-names', 'pointer-events': 'none' });
    for (const [label,x,y] of [['NORTH ATLANTIC',435,235],['SOUTH ATLANTIC',525,485],['PACIFIC OCEAN',105,380],['INDIAN OCEAN',830,487]]) {
      const text=node('text',{x,y});text.textContent=label;oceans.append(text);
    }
    svg.append(oceans);this.seas=node('g',{class:'sea-connections','pointer-events':'none'});
    for(const edge of map.edges.filter(e=>e.sea)) this.seas.append(node('path',{d:this.path(edge.from,edge.to),'data-edge':`${edge.from}|${edge.to}`}));
    svg.append(this.seas);this.territories=node('g');
    for(const p of map.provinces) {
      const shape=node('path',{d:p.path,id:`${this.prefix}province-${p.id}`,'data-province':p.id,class:'province',fill:'#b9b6a3'});
      this.territories.append(shape);this.shapes.set(p.id,shape);
    }
    svg.append(this.territories);
    this.connections=node('g',{'pointer-events':'none'});this.routes=node('g',{'pointer-events':'none'});this.marches=node('g',{'pointer-events':'none'});
    svg.append(this.connections,this.routes,this.marches);
    const markers=node('g');
    for(const p of map.provinces) {
      const group=node('g',{id:`${this.prefix}marker-${p.id}`,'data-province':p.id,tabindex:0,role:'button',class:'map-counter'});
      const disc=node('circle',{r:10});const text=node('text',{y:.5,class:'counter-value',id:`${this.prefix}troops-${p.id}`});
      const label=node('text',{y:-17,class:'province-name'});label.textContent=p.name;
      const industry=node('text',{y:21,class:'industry-label'});group.append(industry);
      group.append(disc,text,label);markers.append(group);this.markers.set(p.id,{group,disc,text,label,industry});
    }
    svg.append(markers);
    this.tooltip=document.createElement('div');this.tooltip.className='atlas-tooltip';this.tooltip.hidden=true;svg.parentElement.append(this.tooltip);
    svg.addEventListener('contextmenu',event=>event.preventDefault());
    svg.addEventListener('wheel',event=>{event.preventDefault();this.zoom(event.deltaY>0?1.12:.89,event.clientX,event.clientY);},{passive:false});
    svg.addEventListener('pointerdown',event=>this.down(event));
    svg.addEventListener('pointermove',event=>this.move(event));
    svg.addEventListener('pointerup',event=>this.up(event));
    svg.addEventListener('pointercancel',event=>{this.pointers.delete(event.pointerId);this.gesture=null;this.dragged=true;});
    svg.addEventListener('pointerleave',()=>{this.tooltip.hidden=true;});
    svg.addEventListener('keydown',event=>{
      const id=event.target.closest('[data-province]')?.dataset.province;
      if(id && ['Enter',' '].includes(event.key)){event.preventDefault();onSelect(id,{shiftKey:event.shiftKey});}
    });
    this.resize=new ResizeObserver(()=>this.layout());this.resize.observe(svg);
    this.applyView();
  }
  path(from,to) {
    const a=this.places.get(from),b=this.places.get(to);
    if(Math.abs(a.x-b.x)>640) {
      const [left,right]=a.x<b.x?[a,b]:[b,a];
      return `M${left.x},${left.y}L${right.x-1280},${right.y}M${right.x},${right.y}L${left.x+1280},${left.y}`;
    }
    return `M${a.x},${a.y}L${b.x},${b.y}`;
  }
  coordinates(clientX,clientY) {
    const transform=this.svg.getScreenCTM();
    return transform ? new DOMPoint(clientX,clientY).matrixTransform(transform.inverse()) : {x:0,y:0};
  }
  down(event) {
    if(event.button!==0 && event.button!==2)return;
    this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    this.svg.setPointerCapture(event.pointerId);
    if(this.pointers.size===1) {
      this.gesture={x:event.clientX,y:event.clientY,vx:this.view.x,vy:this.view.y,
        id:event.target.closest('[data-province]')?.dataset.province,shiftKey:event.shiftKey,target:event.button===2};this.dragged=false;
    } else {this.dragged=true;this.gesture=null;this.pinchDistance=this.distance();}
    this.tooltip.hidden=true;
  }
  distance() {const [a,b]=this.pointers.values();return b?Math.hypot(a.x-b.x,a.y-b.y):0;}
  move(event) {
    if(!this.pointers.has(event.pointerId)) {this.hover(event);return;}
    this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(this.pointers.size===2) {
      const points=[...this.pointers.values()],distance=this.distance();
      if(this.pinchDistance && distance)this.zoom(this.pinchDistance/distance,(points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);
      this.pinchDistance=distance;return;
    }
    if(!this.gesture)return;
    const dx=event.clientX-this.gesture.x,dy=event.clientY-this.gesture.y;
    if(Math.abs(dx)+Math.abs(dy)>6)this.dragged=true;
    if(this.dragged) {
      const scale=this.svg.getScreenCTM()?.a || 1;
      this.view.x=this.gesture.vx-dx/scale;this.view.y=this.gesture.vy-dy/scale;this.applyView();
    }
  }
  up(event) {
    const gesture=this.gesture;this.pointers.delete(event.pointerId);
    if(this.svg.hasPointerCapture(event.pointerId))this.svg.releasePointerCapture(event.pointerId);
    if(!this.dragged && gesture?.id)this.onSelect(gesture.id,{shiftKey:gesture.shiftKey,target:gesture.target});
    if(!this.pointers.size)this.gesture=null;
  }
  hover(event) {
    const id=event.target.closest('[data-province]')?.dataset.province;
    const p=this.state?.provinces.find(p=>p.id===id);
    if(!p){this.tooltip.hidden=true;return;}
    this.tooltip.replaceChildren();
    const title=document.createElement('strong');title.textContent=this.places.get(id).name;
    const detail=document.createElement('span');detail.textContent=`${this.countries.get(p.owner)?.name || 'Uncontrolled'} · ${p.troops} troops${this.state.rules.distanceMovement?` · industry ${p.development}`:''}`;
    this.tooltip.append(title,detail);this.tooltip.hidden=false;
    const rect=this.svg.parentElement.getBoundingClientRect();
    this.tooltip.style.left=`${clamp(event.clientX-rect.left+14,8,rect.width-260)}px`;
    this.tooltip.style.top=`${Math.max(8,event.clientY-rect.top-65)}px`;
  }
  applyView() {
    this.view.x=clamp(this.view.x,-this.view.w*.35,1280-this.view.w*.65);
    this.view.y=clamp(this.view.y,-this.view.h*.35,680-this.view.h*.65);
    this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    this.layout();
  }
  zoom(factor,clientX,clientY) {
    const rect=this.svg.getBoundingClientRect();
    const anchor=this.coordinates(clientX ?? rect.left+rect.width/2,clientY ?? rect.top+rect.height/2);
    const w=clamp(this.view.w*factor,135,1450),ratio=w/this.view.w;
    this.view={x:anchor.x-(anchor.x-this.view.x)*ratio,y:anchor.y-(anchor.y-this.view.y)*ratio,w,h:this.view.h*ratio};
    this.applyView();
  }
  world(){this.view={x:0,y:0,w:1280,h:680};this.applyView();}
  europe(){this.view={x:588,y:70,w:230,h:122.2};this.applyView();}
  focus(id){const p=this.places.get(id);if(!p)return;this.view={x:p.x-195,y:p.y-104,w:390,h:208};this.applyView();}
  home(country){const c=this.countries.get(country);if(c)this.focus(c.start[0]);}
  layout() {
    const matrix=this.svg.getScreenCTM();if(!matrix || matrix.a<=0)return;
    const scale=1/matrix.a,zoom=1280/this.view.w,shown=[];
    // Keep counters readable at a constant screen size; declutter crowded neutral
    // markers first. Province paths and the inspector remain selectable at all zooms.
    const order=[...this.map.provinces].sort((a,b)=>this.priority(b.id)-this.priority(a.id));
    for(const p of order) {
      const marker=this.markers.get(p.id),priority=this.priority(p.id);
      const crowded=shown.some(s=>Math.hypot(s.x-p.x,s.y-p.y)<21*scale);
      const visible=priority>=4 || !crowded || zoom>4;
      marker.group.setAttribute('transform',`translate(${p.x} ${p.y}) scale(${scale})`);
      marker.group.classList.toggle('counter-hidden',!visible);
      marker.label.style.display=zoom>=2.1?'':'none';
      marker.disc.setAttribute('r',priority>=4?11:9);
      if(visible)shown.push(p);
    }
    this.svg.classList.toggle('atlas-zoomed',zoom>=2.1);
  }
  priority(id) {
    if(id===this.source || id===this.destination)return 5;
    const p=this.state?.provinces.find(p=>p.id===id);
    if(p?.owner && p.owner===this.state?.you)return 4;
    return p?.owner?2:0;
  }
  update(state,source,destination) {
    if(!this.state || this.state.tick!==state.tick)this.receivedAt=performance.now();
    this.state=state;this.source=source;this.destination=destination;
    const me=state.players.find(p=>p.id===state.you),sides=new Map(state.players.map(p=>[p.id,p.side]));
    const neighbors=this.places.get(source)?.neighbors || [];
    for(const p of state.provinces) {
      const shape=this.shapes.get(p.id),marker=this.markers.get(p.id);
      shape.setAttribute('fill',this.countries.get(p.owner)?.color || '#aaa994');
      const role=p.id===source?'selected':p.id===destination?'destination':neighbors.includes(p.id)?'neighbor':'';
      shape.setAttribute('class',`province ${role}${p.owner?' occupied':''}`);
      marker.group.setAttribute('class',`map-counter ${role}${p.owner===state.you && state.you?' owned':''}`);
      marker.disc.setAttribute('stroke',this.countries.get(p.owner)?.color || '#a5a28c');
      marker.text.textContent=p.troops;
      marker.industry.textContent=state.rules.distanceMovement && p.owner ? `${'ⅠⅡⅢ'[(p.development || 1)-1]}${p.developing?' ↑':''}`:'';
      marker.group.setAttribute('aria-label',`${this.places.get(p.id).name}, ${p.troops} troops, ${this.countries.get(p.owner)?.name || 'uncontrolled'}`);
    }
    for(const edge of this.seas.children)edge.classList.toggle('selected-connection',edge.dataset.edge.split('|').includes(source));
    this.connections.replaceChildren();
    for(const id of neighbors)this.connections.append(node('path',{d:this.path(source,id),class:id===destination?'target-connection':'adjacent-connection',...(id===destination?{'marker-end':`url(#${this.prefix}march-head)`}:{})}));
    this.routes.replaceChildren();
    for(const p of state.provinces)if(p.route && (p.owner===state.you || p.id===source))this.routes.append(node('path',{d:this.path(p.id,p.route),class:'recruit-connection','marker-end':`url(#${this.prefix}march-head)`}));
    const ids=new Set(state.armies.map(a=>a.id));
    for(const [id,entry] of this.armies)if(!ids.has(id)){entry.group.remove();this.armies.delete(id);}
    for(const army of state.armies) {
      if(!this.armies.has(army.id)) {
        const group=node('g',{class:'moving-army'}),disc=node('circle',{r:4.5}),label=node('text',{y:-10});
        group.append(disc,label);this.marches.append(group);this.armies.set(army.id,{group,disc,label});
      }
      const entry=this.armies.get(army.id),hostile=me && sides.get(army.country)!==me.side && state.provinces.some(p=>p.id===army.to && p.owner===state.you);
      entry.disc.setAttribute('fill',hostile?'#ee987a':this.countries.get(army.country).color);
      entry.group.classList.toggle('hostile',Boolean(hostile));entry.label.textContent=army.amount>=3?army.amount:'';
    }
    this.layout();this.positions();
    if(!this.frame && !this.reducedMotion && state.status==='running')this.frame=requestAnimationFrame(()=>this.animate());
  }
  positions() {
    if(!this.state)return;
    const elapsed=this.reducedMotion || this.state.status!=='running'?0:Math.min(2,(performance.now()-this.receivedAt)/1000)*this.state.speed;
    const scale=1/(this.svg.getScreenCTM()?.a || 1);
    for(const army of this.state.armies) {
      const point=journeyPoint(army,this.positionsById,Math.min(this.state.tick+elapsed,army.arrivesAt-.01));
      this.armies.get(army.id)?.group.setAttribute('transform',`translate(${point.x} ${point.y}) scale(${scale})`);
    }
  }
  destroy(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.resize.disconnect();this.tooltip.remove();}
  animate(){this.frame=null;this.positions();if(this.state?.status==='running')this.frame=requestAnimationFrame(()=>this.animate());}
}
