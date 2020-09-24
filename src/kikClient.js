const EventEmitter = require("events"),
    KikConnection = require("./kikConnection"),
    DataHandler = require("./handlers/dataHandler"),
    Logger = require("./logger"),
    ImageManager = require("./imgManager"),
    sessionUtils = require("./sessionUtils"),
    initialRequest = require("./requests/initialRequest"),
    getNode = require("./requests/getNode"),
    auth = require("./requests/auth"),
    getRoster = require("./requests/account/getRoster"),
    sendChatMessage = require("./requests/sendChatMessage"),
    getJidInfo = require("./requests/getJidInfo"),
    removeFriend = require("./requests/account/removeFriend"),
    addFriend = require("./requests/account/addFriend"),
    setAdmin = require("./requests/group/setAdmin"),
    setBanned = require("./requests/group/setBanned"),
    setGroupMember = require("./requests/group/setGroupMember"),
    setGroupName = require("./requests/group/setGroupName"),
    setProfileName = require("./requests/account/setProfileName"),
    sendImage = require("./requests/sendImage"),
    leaveGroup = require("./requests/group/leaveGroup"),
    setEmail = require("./requests/account/setEmail"),
    setPassword = require("./requests/account/setPassword");

module.exports = class KikClient extends EventEmitter {
    constructor(params){
        super();

        this.params = params;
        this.dataHandler = new DataHandler(this);
        this.logger = new Logger(["info", "warning", "error"], this.params.username);
        this.imgManager = new ImageManager(this.params.username, true);

        //used for tracking
        this.groups = [];
        this.friends = [];
        this.users = [];

        this.on("receivedroster", (groups, friends) => {
            this.groups = groups;
            if(this.params.trackUserInfo){
                //perhaps i could combine and send to make it more efficient, depending on the rate limit
                this.groups.forEach((group) => {
                    this.getJidInfo(group.users);
                });
            }
            if(this.params.trackFriendInfo){
                this.friends = friends;
            }
        });
        this.on("receivedjidinfo", (users) => {
            if(this.params.trackUserInfo){
                this.users.push(...users);
            }
        });
        this.on("userleftgroup", (user) => {
            this.users.splice(user, 1);
        });
        this.on("receivedcaptcha", (captchaUrl) => {
            if(this.params.promptCaptchas){
                let stdin = process.stdin, stdout = process.stdout;

                console.log("Please resolve captcha by going to: " + captchaUrl);
                stdout.write("Captcha response: ");

                stdin.once("data", (data) => {
                    this.resolveCaptcha(data.toString().trim());
                });
            }
        });
    }
    connect(){
        this.connection = new KikConnection(this.logger, err => {
            if(err){
                this.logger.log("error", err);
            }else{
                //don't read it from file again if it's already set
                this.session = (this.session? this.session : sessionUtils.getSession(this.params.username));
                if(this.session.node){
                    this.authRequest();
                }else{
                    this.initiateNodeConnection();
                }
            }
        });
        this.connection.on("data", (data) => {
            this.dataHandler.handleData(data);
        });
    }
    //used to set the node and start an authorized session
    setNode(node){
        //append the node to the session object
        this.session = {...this.session, node: node};
        sessionUtils.setSession(this.params.username, this.session);
        //we have to disconnect first, then initiate a new connection, with the node set this time
        this.connection.disconnect();
        this.connect();
    }
    //we have to do this before requesting the kik node, but not before auth
    initiateNodeConnection(){
        this.logger.log("info", "Initiating kik node connection");
        this.connection.sendXmlFromJs(initialRequest(), true);
    }
    getNode(){
        this.logger.log("info", "Requesting kik node");
        this.connection.sendXmlFromJs(getNode(this.params.username, this.params.password, this.session.deviceID,
            this.session.androidID));
    }
    resolveCaptcha(response){
        this.logger.log("info", `Resolving captcha with response ${response}`);
        this.connection.sendXmlFromJs(getNode(this.params.username, this.params.password, this.session.deviceID,
            this.session.androidID, response));
    }
    authRequest(){
        this.logger.log("info", "Sending auth request");
        this.connection.sendXmlFromJs(auth(this.params.username, this.params.password, this.session.node,
            this.session.deviceID), true);
    }
    getRoster(callback){
        this.logger.log("info", "Getting roster");
        let req = getRoster();
        this.connection.sendXmlFromJs(req.xml);
        if(callback){
            this.dataHandler.addCallback(req.id, callback);
        }
    }
    sendMessage(jid, msg, callback){
        this.logger.log("info",
            `Sending ${jid.endsWith("groups.kik.com")? "group" : "private"} message to ${jid} Content: ${msg}`);
        let req = sendChatMessage(jid, msg, jid.endsWith("groups.kik.com"));
        this.connection.sendXmlFromJs(req.xml);
        if(callback){
            this.dataHandler.addCallback(req.id, callback);
        }
    }
    sendImage(jid, imgPath, allowForwarding, callback){
        this.logger.log("info",
            `Sending ${jid.endsWith("groups.kik.com")? "group" : "private"} image to ${jid} Path: ${imgPath}`);
        let req = sendImage(jid, imgPath, jid.endsWith("groups.kik.com"), allowForwarding);
        this.connection.sendXmlFromJs(req.xml);
        if(callback){
            this.dataHandler.addCallback(req.id, callback);
        }
    }
    getJidInfo(jids, callback){
        this.logger.log("info", `Requesting JID info for ${jids}`);
        let req = getJidInfo(jids);
        this.connection.sendXmlFromJs(req.xml);
        if(callback){
            this.dataHandler.addCallback(req.id, callback);
        }
    }
    addFriend(jid){
        this.logger.log("info", `Adding friend with JID ${jid}`);
        this.connection.sendXmlFromJs(addFriend(jid));
    }
    removeFriend(jid){
        this.logger.log("info", `Removing friend with JID ${jid}`);
        this.connection.sendXmlFromJs(removeFriend(jid));
    }
    setAdmin(groupJid, userJid, bool){
        this.logger.log("info", `Setting admin = ${bool} for jid ${userJid} in group ${groupJid}`);
        this.connection.sendXmlFromJs(setAdmin(groupJid, userJid, bool));
    }
    setBanned(groupJid, userJid, bool){
        this.logger.log("info", `Setting banned = ${bool} for jid ${userJid} in group ${groupJid}`);
        this.connection.sendXmlFromJs(setBanned(groupJid, userJid, bool));
    }
    setGroupMember(groupJid, userJid, bool){
        this.logger.log("info", `Setting member = ${bool} for jid ${userJid} in group ${groupJid}`);
        this.connection.sendXmlFromJs(setGroupMember(groupJid, userJid, bool));
    }
    setGroupName(groupJid, groupName){
        this.logger.log("info", `Setting group name to ${groupName} for group ${groupJid}`);
        this.connection.sendXmlFromJs(setGroupName(groupJid, groupName));
    }
    setProfileName(firstName, lastName){
        this.logger.log("info", `Setting profile name to ${firstName} ${lastName}`);
        this.connection.sendXmlFromJs(setProfileName(firstName, lastName));
    }
    leaveGroup(groupJid){
        this.logger.log("info", `Leaving group ${groupJid}`);
        this.connection.sendXmlFromJs(leaveGroup(groupJid));
    }
    setEmail(newEmail, password){
        this.logger.log("info", `Setting email to ${newEmail}`);
        this.connection.sendXmlFromJs(setEmail(newEmail, password));
    }
    setPassword(oldPassword, newPassword){
        this.logger.log("info", "Setting password");
        this.connection.sendXmlFromJs(setPassword(oldPassword, newPassword));
    }
};

