/**
 * Created by NagarjunaYendluri on 4/11/16.
 */

'use strict';

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    sessions = require( 'client-sessions' ),
    app = express(),
    _getAudio,
    _getImage,
    _startRoute;
var speakeasy = require('speakeasy');

//mongodb connection- connect ot users collection
var mongojs = require("mongojs");
var db = mongojs('dbuser:Password1@ds019940.mlab.com:19940/iws2project', ['users']);

// Set session information
app.use( sessions({
    cookieName: 'session',
    secret: 'someRandomSecret!',
    duration: 24 * 60 * 60 * 1000,
    activeDuration: 1000 * 60 * 5
}) );

// Enable CORS
app.use( function( req, res, next ) {
    res.header( 'Access-Control-Allow-Origin', '*' );
    next();
} );

// parse application/x-www-form-urlencoded
app.use( bodyParser.urlencoded({ extended: false }) );
// parse application/json
app.use( bodyParser.json() );

// Set public path
app.use( express.static( __dirname + '/public' ) );

// Define routes functions
// Fetches and streams an audio file
_getAudio = function( req, res, next ) {
    var visualCaptcha;

    // Default file type is mp3, but we need to support ogg as well
    if ( req.params.type !== 'ogg' ) {
        req.params.type = 'mp3';
    }

    // Initialize visualCaptcha
    visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );

    visualCaptcha.streamAudio( res, req.params.type );
};

// Fetches and streams an image file
_getImage = function( req, res, next ) {
    var visualCaptcha,
        isRetina = false;

    // Initialize visualCaptcha
    visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );

    // Default is non-retina
    if ( req.query.retina ) {
        isRetina = true;
    }

    visualCaptcha.streamImage( req.params.index, res, isRetina );
};

// Start and refresh captcha options
_startRoute = function( req, res, next ) {
    var visualCaptcha;

    // Initialize visualCaptcha
    visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );

    visualCaptcha.generate( req.params.howmany );

    // We have to send the frontend data to use on POST.
    res.status( 200 ).send( visualCaptcha.getFrontendData() );
};

// Try to validate the captcha
// We need to make sure we generate new options after trying to validate, to avoid abuse
var validateCaptcha = function( req, formData ) {
    var visualCaptcha,
        frontendData,
        imageAnswer,
        audioAnswer;

    // Initialize visualCaptcha
    visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );

    frontendData = visualCaptcha.getFrontendData();

    // It's not impossible this method is called before visualCaptcha is initialized, so we have to send a 404
    if ( typeof frontendData === 'undefined' ) {
        return 1;//noCaptcha

    } else {
        // If an image field name was submitted, try to validate it
        if ( ( imageAnswer = formData[ frontendData.imageFieldName ] ) ) {
            if ( visualCaptcha.validateImage( imageAnswer ) ) {
                return 0;//validImage

            } else {
                return 1;//failedImage

            }
        } else if ( ( audioAnswer = formData[ frontendData.audioFieldName ] ) ) {
            // We set lowercase to allow case-insensitivity, but it's actually optional
            if ( visualCaptcha.validateAudio( audioAnswer.toLowerCase() ) ) {
                return 0;//validAudio

            } else {
                return 1;//failedAudio

            }
        } else {
            return 1;//failedPost

        }
    }

};



//variable that stores current session secret key- changes on page reload
var sessionSecret;
//function that generates QR code details
var generateQRcode = function(req,res){

    //generate secret key
    var secret = speakeasy.generateSecret({length: 20});

    //save the current secret in session variable
    sessionSecret = secret.base32;

    //build response object
    var totpData = {
        "otpauthurl":secret.otpauth_url
    }

    //return qr data
    res.json(totpData);
}

//function to verify if user key is valid TOTP
var verifyQrCode = function(base32secret,userKey,callback){
    var verified = speakeasy.totp.verify({ secret: base32secret,
        encoding: 'base32',
        token: userKey });
    if(callback!=undefined){
        callback(verified);
    }
}

//function to check if user exists
var checkUser = function(userName, callback){
    
    db.users.findOne({userName:userName }, function(err,doc){
        //if error return
        if(err){
            console.log("error while finding user");
        }
        else{
            //if user exists
            if(doc){
                console.log("user found");
                if(callback != undefined){
                    callback(true,doc);
                }
            }
            else{
                console.log("user Not found");
                //if here no user found
                if(callback!=undefined){
                    callback(false);
                }
            }
        }
        
    });
}

//function that registers users
var _tryRegister = function(req, res, next){

    //define response object
    var response = {};
    
    //check if sessiob=n key exist
    if(sessionSecret){
        
        var verifyQrCodeCB = function(validKey){
            if(validKey){
            
            //callback function to handle check user function
            var checkUserCB = function(userExist){
                
                console.log(userExist);
                //if user exists return response
                if(userExist){
                    console.log("inside user exists");
                    //return response
                    response = {
                        "code": 1,
                        "text":"User already exists. Please try logging in"
                    };
                    
                    return res.json(response);
                    
                }
                //if user does not exist
                else{
                    console.log("inside user not exist");
                    //add to database
                    var user = {
                        "userName":req.body.userName,
                        "password":req.body.userPass,
                        "secretKey": sessionSecret
                    }
                    db.users.insert(user,function(err,doc){
                        console.log("User Added.. " + doc._id);
                        return res.json({"code":0});
                    });
                }
            }
            
            //check if user exists
            checkUser(req.body.userName, checkUserCB);
            
        }
        
            else{
            //if here not valid key
            response = {
                code:1,
                text:"Authentication key is not valid"
            }
            return res.json(response);
        }
        }
        //validate user key
        verifyQrCode(sessionSecret,req.body.userKey, verifyQrCodeCB);
        
    }

    
}

//function that validates login 
var _tryLogin = function( req, res, next ){
    
    //get user data
    var user = req.body;
    
    //validate captcha
    var captchaResult = validateCaptcha(req, req.body);
    
    //return if not valid captcha
    if(captchaResult != 0){
        var result = {
            code:1,
            text: "Not Valid Captcha"
        }
        return res.json(result);
    }
    
    //if captcha valid
    else{
        //check if user exists
        var checkUserCB = function(userExists,userDoc){
            
            //if exists login
            if(userExists){
                
                //if user exists
                if(userDoc!=undefined){
                    
                    //function to validate qr code
                    var verifyQrCodeCB = function(validKey){
                        //if valid key
                        if(validKey){
                            
                            //check user name and password
                            if(userDoc.password == user.userPass){
                                return res.json({
                                    "code":0
                                });
                            }
                            else{
                                return res.json({
                                    "code":1,
                                    "text": "User Name/Password wrong!"
                                });
                            }
                            
                        }
                        //else ask to re-enter key
                        else{
                            return res.json({
                                "code":1,
                                "text":"TOTP key not valid. Please re-enter key"
                            });
                        }
                    }
                    //verify qr code
                    verifyQrCode(userDoc.secretKey,user.userKey,verifyQrCodeCB)
                }
               
            }
            
            //else ask to register- if here user does not exist
            else{
                return res.json({
                    "code":1,
                    "text": "User does not exist. Please Register"
                })
            }
        }
        
        checkUser(user.userName, checkUserCB)
        
    }


};

// Routes definition
app.post( '/login', _tryLogin );
app.post('/register', _tryRegister);
app.get('/getqrcode', generateQRcode);

// @param type is optional and defaults to 'mp3', but can also be 'ogg'
app.get( '/audio', _getAudio );
app.get( '/audio/:type', _getAudio );

// @param index is required, the index of the image you wish to get
app.get( '/image/:index', _getImage );

// @param howmany is required, the number of images to generate
app.get( '/start/:howmany', _startRoute );

module.exports = app;

// API Listening Port
//app.listen( process.env.PORT || 8282 );
//console.log("Server started at http://localhost:8282");

app.listen(process.env.PORT || 9025, process.env.IP || "0.0.0.0", function(){
  console.log("server listening at", 9025);
});