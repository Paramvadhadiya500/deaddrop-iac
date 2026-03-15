const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    // 🛡️ Ensure CORS is always returned
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
    };

    try {
        const body = JSON.parse(event.body);
        const { secretId, uploadId, etags, secretData, hasFile, maxViews, expireSeconds, wantsAlert } = body;

        // 1. Stitch S3 chunks together if a file exists
        if (hasFile) {
            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${secretId}`,
                MultipartUpload: { Parts: etags },
                UploadId: uploadId
            }).promise();
        }

        // 2. Prepare the database record
        const item = {
            secretId,
            secretData,
            hasFile,
            viewsRemaining: maxViews,
            wantsAlert: wantsAlert || false, // 👈 NEW: Save the audit preference!
            createdAt: new Date().toISOString()
        };

        // 3. Attach TTL (Time To Live) if provided
        if (expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + expireSeconds;
        }

        // 4. Commit to DynamoDB
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: secretId }) };
    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Internal server error" }) };
    }
};