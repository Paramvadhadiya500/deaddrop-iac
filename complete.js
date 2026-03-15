const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    try {
        const body = JSON.parse(event.body);
        // Safely generate an ID using standard Math logic so we don't rely on strict Crypto modules
        const finalId = body.secretId || (Date.now().toString(36) + Math.random().toString(36).substring(2));

        if (body.hasFile && body.etags && body.uploadId) {
            const fixedParts = body.etags.map(part => ({
                PartNumber: part.PartNumber,
                ETag: part.ETag.includes('"') ? part.ETag : `"${part.ETag}"`
            }));

            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${finalId}`,
                MultipartUpload: { Parts: fixedParts },
                UploadId: body.uploadId
            }).promise();
        }

        const item = {
            secretId: finalId,
            secretData: body.secretData || "EMPTY",
            hasFile: body.hasFile || false,
            viewsRemaining: body.maxViews ? parseInt(body.maxViews) : 1,
            wantsAlert: body.wantsAlert || false,
            createdAt: new Date().toISOString()
        };

        if (body.expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + parseInt(body.expireSeconds);
        }

        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: finalId }) };
    } catch (error) {
        console.error("LAMBDA ERROR:", error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
    }
};