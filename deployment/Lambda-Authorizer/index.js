const OktaJwtVerifier = require("@okta/jwt-verifier");

const issuerUrl = process.env.OKTA_ISSUER_URL;

const oktaJwtVerifier = new OktaJwtVerifier({
  issuer: issuerUrl
});

// Node.js 24 and later runtimes no longer support callback-based handlers, so
// this handler returns the policy document and throws "Unauthorized" to deny.
exports.handler = async (event) => {
  const token = event.authorizationToken;
  if (!token) {
    throw new Error("Unauthorized");
  }

  const match = token.match(/Bearer (.+)/);
  if (!match) {
    throw new Error("Unauthorized");
  }

  const accessToken = match[1];
  if (!accessToken) {
    console.log("No access token");
    throw new Error("Unauthorized");
  }

  let jwt;
  try {
    jwt = await oktaJwtVerifier.verifyAccessToken(accessToken, 'api://default');
  } catch (err) {
    console.warn('Token failed validation:', err.message);
    throw new Error("Unauthorized");
  }

  console.log('Token is valid');

  return generatePolicy(jwt.claims.sub, 'Allow', event.methodArn);
};

const generatePolicy = (principalId, effect, resource) => {
  const authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  console.log('Generated policy:', JSON.stringify(authResponse, null, 2));
  return authResponse;
};