import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('a newcomer sees an editable selection form without already having a role model',async()=>{
 process.env.VITE_FIREBASE_API_KEY ||= 'isolated-test-api-key';
 process.env.VITE_FIREBASE_AUTH_DOMAIN ||= 'isolated-test.firebaseapp.com';
 process.env.VITE_FIREBASE_PROJECT_ID ||= 'isolated-test';
 process.env.VITE_FIREBASE_APP_ID ||= '1:test:web:test';
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});
 try{
  const {default:RoleModelSetup}=await server.ssrLoadModule('/src/pages/RoleModelSetup.jsx');
  const markup=renderToStaticMarkup(React.createElement(RoleModelSetup,{onComplete(){}}));
  assert.match(markup,/Pick your role model/);
  assert.match(markup,/<form/);
  assert.match(markup,/Role model name/);
  assert.match(markup,/<input[^>]+type="text"/);
  assert.match(markup,/Set role model/);
  assert.doesNotMatch(markup,/No role models available/);
  assert.doesNotMatch(markup,/type="url"/);
 }finally{await server.close();}
});
