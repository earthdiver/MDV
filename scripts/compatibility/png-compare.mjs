import {PNG} from 'pngjs';

// Decode PNG bytes directly: oversized browser canvases can silently read as
// transparent, incorrectly declaring two different long documents identical.
export function comparePng(expected, actual, tolerance=16) {
  const a=PNG.sync.read(expected),b=PNG.sync.read(actual);
  const width=Math.max(a.width,b.width),height=Math.max(a.height,b.height);
  const diff=new PNG({width,height});let changed=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const ai=(y*a.width+x)*4,bi=(y*b.width+x)*4,di=(y*width+x)*4;
    const missing=x>=a.width||y>=a.height||x>=b.width||y>=b.height;
    const different=missing||Math.abs(a.data[ai]-b.data[bi])>tolerance||Math.abs(a.data[ai+1]-b.data[bi+1])>tolerance||Math.abs(a.data[ai+2]-b.data[bi+2])>tolerance||Math.abs(a.data[ai+3]-b.data[bi+3])>tolerance;
    if(different)changed++;
    diff.data[di]=different?255:220;diff.data[di+1]=different?0:220;diff.data[di+2]=different?90:220;diff.data[di+3]=255;
  }
  return {expectedSize:[a.width,a.height],actualSize:[b.width,b.height],sameSize:a.width===b.width&&a.height===b.height,
    changedPixels:changed,totalPixels:width*height,ratio:changed/(width*height),diff:PNG.sync.write(diff)};
}

export function cropPng(png,top,bottom) {
  top=Math.max(0,top);bottom=Math.min(png.height,bottom);
  const crop=new PNG({width:png.width,height:Math.max(1,bottom-top)});
  png.data.copy(crop.data,0,top*png.width*4,bottom*png.width*4);
  return PNG.sync.write(crop);
}
