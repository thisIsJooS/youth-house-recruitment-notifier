const AWS = require("aws-sdk");
AWS.config.update({ region: "ap-northeast-2" });

const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const s3 = new AWS.S3();
const sns = new AWS.SNS({ apiVersion: "2010-03-31" });

exports.handler = async (event, context) => {
  let browser = null;

  const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
  const S3_BUCKET = process.env.S3_BUCKET;

  if (!SNS_TOPIC_ARN || !S3_BUCKET) {
    console.error("환경 변수가 설정되지 않았습니다.");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "환경 변수가 설정되지 않았습니다." }),
    };
  }

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox"],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.goto("https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008");

    await page.waitForSelector("#boardList > tr:nth-child(1) > td:nth-child(1)");

    const index = await page.$eval("#boardList > tr:nth-child(1) > td:nth-child(1)", (element) => element.textContent.trim());

    const params = { Bucket: S3_BUCKET, Key: "latest-index.txt" };

    let latestIndex;
    try {
      const s3Data = await s3.getObject(params).promise();
      latestIndex = s3Data.Body.toString("utf-8").trim();
    } catch (error) {
      if (error.code === "NoSuchKey") {
        const putParams = { Bucket: S3_BUCKET, Key: "latest-index.txt", Body: "0" };
        await s3.putObject(putParams).promise();
        latestIndex = "0";
      } else {
        throw error;
      }
    }

    if (latestIndex !== index) {
      const putParams = { Bucket: S3_BUCKET, Key: "latest-index.txt", Body: index };
      await s3.putObject(putParams).promise();

      // SNS를 통해 이메일로 알림을 전송합니다.
      const classification = await page.$eval('#boardList > tr:nth-child(1) > td:nth-child(2) > span',element => element.textContent.trim());
      const announcementName = await page.$eval('#boardList > tr:nth-child(1) > td.align_left > a', element => element.textContent.trim());
      const announcementDate = await page.$eval('#boardList > tr:nth-child(1) > td:nth-child(4)', element => element.textContent.trim());
      const applicationDate = await page.$eval('#boardList > tr:nth-child(1) > td:nth-child(5)', element => element.textContent.trim());
      const operator = await page.$eval('#boardList > tr:nth-child(1) > td:nth-child(6)', element => element.textContent.trim());

      const message
          = `서울특별시 청년안심주택의 새로운 모집 공고가 게시되었습니다.\n\n` +
          `공고 번호 : ${index}\n` +
          `구분 (민간/공공) : ${classification}\n` +
          `공고명 : ${announcementName}\n` +
          `공고 게시일 : ${announcementDate}\n` +
          `청약 신청일 : ${applicationDate}\n` +
          `담당부서/사업자 : ${operator}\n\n` +
          `확인하러 가기 --> https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008 \n\n`;

      const snsParams = {
        Subject: '[서울특별시 청년안심주택] 새로운 모집 공고가 게시되었습니다.',
        Message: message,
        TopicArn: SNS_TOPIC_ARN
      };
      await sns.publish(snsParams).promise();
    }

    return { statusCode: 200, body: JSON.stringify({ message: "작업 완료" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  } finally {
    if (browser !== null) {
      let pages = await browser.pages();
      await Promise.all(pages.map((page) => page.close()));
      await browser.close();
    }
  }
};
