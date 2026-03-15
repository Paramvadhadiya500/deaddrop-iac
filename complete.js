const AWS = require("aws-sdk");
const crypto = require("crypto"); // 👈 NEW: Built-in crypto for ID generation
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    // 🛡️ Bulletproof CORS Headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": true,
    };

    try {
        const body = JSON.parse(event.body);
        const { secretId, uploadId, etags, secretData, hasFile, maxViews, expireSeconds, wantsAlert } = body;

        // 🛠️ FIX: If there is no file, generate a secure ID on the backend!
        const finalId = secretId || crypto.randomUUID();

        // 1. Stitch S3 chunks together if a file exists
        if (hasFile) {
            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${finalId}`,
                MultipartUpload: { Parts: etags },
                UploadId: uploadId
            }).promise();
        }

        // 2. Prepare the database record
        const item = {
            secretId: finalId, // 👈 Use the guaranteed ID
            secretData,
            hasFile,
            viewsRemaining: maxViews,
            wantsAlert: wantsAlert || false, 
            createdAt: new Date().toISOString()
        };

        // 3. Attach TTL (Time To Live) if provided
        if (expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + expireSeconds;
        }

        // 4. Commit to DynamoDB
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: finalId }) };
    } catch (error) {
        console.error("CRITICAL LAMBDA ERROR:", error);
        return { 
            statusCode: 500, 
            headers: corsHeaders, 
            body: JSON.stringify({ error: error.message || "Internal server error" }) 
        };
    }
};