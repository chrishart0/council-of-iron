import test from 'node:test';
import assert from 'node:assert/strict';
import { faction, insignia, icon, battleSignal } from '../public/presentation.js';

test('eight original insignia are distinct constants, decorative SVG never accepts player markup',()=>{
  const ids=['britain','france','germany','russia','ottoman','qing','japan','usa'];
  assert.equal(new Set(ids.map(insignia)).size,8);
  for(const id of ids){assert.match(insignia(id),/aria-hidden="true"/);assert.ok(faction(id).short);}
  for(const key of ['<script>alert(1)</script>','__proto__','constructor',null]){
    assert.equal(insignia(key),insignia('observer'));assert.equal(faction(key).short,'Observer');
  }
});
test('shared icons contain no external URLs, duplicate IDs or execution hooks',()=>{
  for(const key of ['march','council','dispatches','land','troops','laurel','play','war','treaty','ribbon','gear','fallen','threat','constructor']){
    const svg=icon(key);assert.match(svg,/viewBox="0 0 24 24"/);
    assert.doesNotMatch(svg,/(?:https?:|href=|<script|\sid=|onerror=|function Object)/);
  }
});
const state={you:'germany',status:'running',tick:50};
const battle={id:101,type:'battle',tick:49,province:'ruhr',previousOwner:'france',owner:'germany',troops:7};
test('battle signals distinguish capture, defense and loss only from completed battle facts',()=>{
  assert.equal(battleSignal(state,[battle]).title,'Province secured');
  assert.equal(battleSignal(state,[{...battle,previousOwner:'germany'}]).title,'Line held');
  const loss=battleSignal(state,[{...battle,previousOwner:'germany',owner:'russia'}]);
  assert.equal(loss.title,'Province lost');assert.equal(loss.tone,'lost');assert.equal(loss.troops,7);
});
test('battle signals ignore old, future, unrelated, spectator and finished-match events',()=>{
  for(const e of [{...battle,tick:20},{...battle,tick:51},{...battle,type:'order_accepted'},{...battle,owner:'russia'}])assert.equal(battleSignal(state,[e]),null);
  assert.equal(battleSignal({...state,you:null},[battle]),null);
  assert.equal(battleSignal({...state,status:'finished'},[battle]),null);
  assert.equal(battleSignal(state,[battle,{...battle,id:102,tick:50}]).id,102);
});
