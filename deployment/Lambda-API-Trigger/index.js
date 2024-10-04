const AWS = require('aws-sdk');

const parsePhoneNumber = require('libphonenumber-js');

var aws_region = "us-east-1";

var destinationNumber = "";

var userLanguage = "";

var messageType = "TRANSACTIONAL";

const originationIdentities = require('./originationIdentities.json');


AWS.config.update({ region: aws_region });

exports.handler = async (event) => {
  console.log(event.body);
  const data = (JSON.parse(event.body)).data;

  destinationNumber = data.messageProfile["phoneNumber"];
  if (!destinationNumber.startsWith("+")) {
    destinationNumber = "+" + destinationNumber;
  }
  
  if (data.messageProfile["locale"])
    userLanguage = data.messageProfile["locale"];

  var userOtpCode = data.messageProfile["otpCode"];

  var deliveryChannel = data.messageProfile["deliveryChannel"].toLowerCase();

  var messageObj = await getMessageFromDynamo(userLanguage, deliveryChannel);
  if (!messageObj) {
    return getErrorResponse(deliveryChannel, {message: "Message not found for language: " + userLanguage});
  }

    function formatOtp(otpCode, deliveryChannel) {
      if (deliveryChannel === 'voice call') {
        return otpCode.split('').join(', ');
      } else {
        return otpCode;
      }
    }
    
    messageObj['message'] = messageObj['message']
      .replace('@otp', formatOtp(userOtpCode, deliveryChannel))
      .replace('@otp2', formatOtp(userOtpCode, deliveryChannel));
  
  if (deliveryChannel === "sms") {
    return await sendSms(messageObj['message'])
      .then(data => {
        return getSuccessResponse('sms', data["MessageId"]);
      })
      .catch(err => {
        console.error(err);
        return getErrorResponse('sms', err);
      });
      } else {
    return await makeCall(messageObj)
      .then(data => {
        return getSuccessResponse('voice', data["MessageId"]);
      })
      .catch(err => {
        console.error(err);
        return getErrorResponse('voice', err);
      });
  }
};

async function sendSms(message) {
  const pinpointSMSVoiceV2 = new AWS.PinpointSMSVoiceV2();
  
  const countryCode = getCountryCode(destinationNumber);

  const originationIdentity = originationIdentities[countryCode];

  const params = {
    DestinationPhoneNumber: destinationNumber,
    MessageBody: message,
    MessageType: messageType,
    OriginationIdentity: originationIdentity,
  };
  
  return new Promise((resolve, reject) => {
    pinpointSMSVoiceV2.sendTextMessage(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

async function makeCall(messageObj) {
  var pinpointsmsvoice = new AWS.PinpointSMSVoiceV2();
  
  const countryCode = getCountryCode(destinationNumber);

  const originationIdentity = originationIdentities[countryCode];

  var params = {
    DestinationPhoneNumber: destinationNumber,
    MessageBody: messageObj.message,
    MessageBodyTextType: 'SSML',
    VoiceId: messageObj.voiceid,
    OriginationIdentity: originationIdentity,
  };

  return new Promise((resolve, reject) => {
    pinpointsmsvoice.sendVoiceMessage(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function getCountryCode(phoneNumber) {
  try {
    const parsedNumber = parsePhoneNumber(phoneNumber);
    return parsedNumber.country ? parsedNumber.country.toUpperCase() : '';
  } catch (error) {
    console.error('Error parsing phone number:', error);
    return '';
  }
}

function getSuccessResponse(method, sid) {
  console.log("Successfully sent " + method + " : " + sid);
  const actionKey = "com.okta.telephony.action";
  const actionVal = "SUCCESSFUL";
  const providerName = "AWS End User Messaging";
  const resp = {
    commands: [
      {
        type: actionKey,
        value: [
          {
            status: actionVal,
            provider: providerName,
            transactionId: sid,
          },
        ],
      },
    ],
  };
  return {
    "statusCode": 200,
    "body": JSON.stringify(resp),
  }
}

function getErrorResponse(method, error) {
  console.log("Error in " + method + " : " + error);
  const errorResp = {
    error: {
      errorSummary: error.message,
    },
  };
  return {
    "statusCode": 400,
    "body": JSON.stringify(errorResp),
  }
}


async function getMessageFromDynamo(language, deliveryChannel) {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const params = {
    TableName: process.env.DYNAMODB_TABLE_NAME,
    FilterExpression: "#language = :language AND #messagetype = :messagetype",
    ExpressionAttributeNames: {
      "#language": "language",
      "#messagetype": "messagetype",
    },
    ExpressionAttributeValues: {
      ":language": language,
      ":messagetype": deliveryChannel,
    },
  };

  try {
    const response = await docClient.scan(params).promise();
    return response.Items[0];
  } catch (error) {
    console.error(error);
    return null;
  }
}