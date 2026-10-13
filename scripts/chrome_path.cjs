// Resolve a local Chrome/Chromium for the synthetic browser tests on Windows, macOS or Linux.
// Order: CHROME_EXECUTABLE env var -> first existing platform default -> undefined (Playwright's bundled Chromium).
const fs=require('node:fs');
const path=require('node:path');

function candidates(){
  if(process.platform==='win32'){
    const roots=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(root=>[
      path.win32.join(root,'Google','Chrome','Application','chrome.exe'),
      path.win32.join(root,'Microsoft','Edge','Application','msedge.exe'),
    ]);
  }
  if(process.platform==='darwin'){
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  }
  return ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
}

function chromeExecutable(){
  if(process.env.CHROME_EXECUTABLE) return process.env.CHROME_EXECUTABLE;
  return candidates().find(p=>{try{return fs.statSync(p).isFile()}catch{return false}});
}

module.exports={chromeExecutable,candidates};
