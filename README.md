# DVEA
### NOTE: This App Is Vulnerable, DO NOT RUN IN PRODUCTION ENVIRONMENT
Damn Vulnerable ElectronJS App (DVEA) is a purposely built vulnerable ElectronJS app for developers and security engineer.

It contains major vulnerabilities that are specific to ElectronJS environment.

The app demonstrates a vulnerable to do list, following vulnerabilties are currently added to the app:
1. Cross Site Scripting
2. XSS to RCE
3. Deep Links to XSS
4. Deep Links to RCE

- - -

## WARNING!

Damn Vulnerable Electron Application is damn vulnerable! **Do not upload it to your hosting provider's public html folder or any Internet facing servers**, as they will be compromised. It is recommended using a virtual machine (such as [VirtualBox](https://www.virtualbox.org/) or [VMware](https://www.vmware.com/)), which is set to NAT networking mode.

### Disclaimer

I does not take responsibility for the way in which any one uses this application (DVEA). I have made the purposes of the application clear and it should not be used maliciously. I have given warnings and taken measures to prevent users from installing DVEA on to live servers. If your server is compromised via an installation of DVEA, it is not my responsibility, it is the responsibility of the person/s who uploaded and installed it.

- - -

- - -
### Download
Get your copy of DVEA from the github releases section here: https://github.com/njmulsqb/DVEA/releases/latest
The binaries are available for Linux, MacOS and Windows.
- - -

### Running from source
```
git clone https://github.com/njmulsqb/DVEA
cd DVEA
npm i
electron .

```



### Credits
The app is built on https://github.com/CodeDraken/electron-todo
