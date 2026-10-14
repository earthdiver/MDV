import {createHash} from 'node:crypto';

// Compare GIFs at frame zero, and compare the complete original byte streams
// separately so later frames are never silently excluded from verification.
export function createImageNormalizer(control) {
  const records=new Map(),cache=new Map();
  async function serve(route,url=route.request().url(),savedResponse=null) {
    if(!cache.has(url))cache.set(url,(async()=>{
      const response=savedResponse?null:await route.fetch({url}),body=savedResponse?.body??await response.body();
      // Browser contexts are closed between documents. Cache detached bytes,
      // never APIResponse handles owned by those contexts.
      const headers={...(savedResponse?.headers??response.headers())};delete headers['content-length'];delete headers['content-encoding'];
      const status=savedResponse?.status??response.status();
      if(!/^GIF8[79]a$/.test(body.subarray(0,6).toString()))return {status,headers,body};
      const sha256=createHash('sha256').update(body).digest('hex');
      const decoded=await control.evaluate(async base64=>{
        const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        const decoder=new ImageDecoder({data,type:'image/gif'});
        try {
          await decoder.tracks.ready;
          const {image}=await decoder.decode({frameIndex:0});
          try {
            const canvas=new OffscreenCanvas(image.displayWidth,image.displayHeight);
            canvas.getContext('2d').drawImage(image,0,0);
            const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
            let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
            return {png:btoa(binary),frames:decoder.tracks.selectedTrack.frameCount};
          } finally {image.close();}
        } finally {decoder.close();}
      },body.toString('base64'));
      records.set(url,{sha256,bytes:body.length,frames:decoded.frames});
      headers['content-type']='image/png';
      return {status,headers,body:Buffer.from(decoded.png,'base64'),contentType:'image/png'};
    })());
    const result=await cache.get(url);
    if(records.has(url))records.set(route.request().url(),records.get(url));
    await route.fulfill(result);
  }
  return {serve,describe:resources=>resources.flatMap(r=>r.visible!==false&&records.has(r.src)?[records.get(r.src)]:[])};
}
