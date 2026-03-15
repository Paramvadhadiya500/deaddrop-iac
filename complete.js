const AWS = require("aws-sdk");
const crypto = require("crypto"); // 👈 The 100% safe, built-in Node.js module
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    // 🛡️ Restored your original, working CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
    };

    try {
        const body = JSON.parse(event.body);
        const { secretId, uploadId, etags, secretData, hasFile, maxViews, expireSeconds, wantsAlert } = body;

        // 1. Generate ID safely if it's a text-only upload
        const finalId = secretId || crypto.randomBytes(16).toString("hex");

        // 2. Stitch S3 chunks (Restored your original, working logic)
        if (hasFile) {
            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${finalId}`,
                MultipartUpload: { Parts: etags },
                UploadId: uploadId
            }).promise();
        }

        // 3. Prepare DynamoDB record
        const item = {
            secretId: finalId,
            secretData: secretData || " ", // DynamoDB crashes on completely empty strings
            hasFile: hasFile,
            viewsRemaining: maxViews,
            wantsAlert: wantsAlert || false, // 👈 The only new feature we actually needed
            createdAt: new Date().toISOString()
        };

        // 4. Attach TTL safely
        if (expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + parseInt(expireSeconds);
        }

        // 5. Commit to Database
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: finalId }) };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
    }
};