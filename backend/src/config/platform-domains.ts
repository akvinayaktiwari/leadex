// Domains at the top of the Common Crawl ranks that are infrastructure, platforms or social networks:
// never worth profiling as a prospect. Matched against the registrable domain exactly.
export const PLATFORM_DOMAINS: readonly string[] = [
  'googleapis.com', 'gstatic.com', 'google.com', 'googletagmanager.com', 'google-analytics.com', 'googleusercontent.com',
  'doubleclick.net', 'youtube.com', 'youtu.be', 'blogger.com', 'blogspot.com', 'goo.gl', 'g.page',
  'facebook.com', 'fb.com', 'instagram.com', 'whatsapp.com', 'messenger.com', 'meta.com',
  'twitter.com', 'x.com', 't.co', 'linkedin.com', 'licdn.com', 'pinterest.com', 'tiktok.com', 'reddit.com',
  'snapchat.com', 'tumblr.com', 'vimeo.com', 'flickr.com', 'medium.com', 'quora.com', 'telegram.org', 't.me',
  'wikipedia.org', 'wikimedia.org', 'wikidata.org', 'archive.org', 'creativecommons.org', 'w3.org', 'schema.org',
  'gmpg.org', 'ogp.me', 'apple.com', 'microsoft.com', 'live.com', 'office.com', 'bing.com', 'yahoo.com', 'amazon.com',
  'amazonaws.com', 'cloudfront.net', 'cloudflare.com', 'akamaihd.net', 'fastly.net', 'jsdelivr.net', 'unpkg.com',
  'cdnjs.com', 'bootstrapcdn.com', 'jquery.com', 'fontawesome.com', 'typekit.net', 'gravatar.com', 'wp.com',
  'wordpress.org', 'wordpress.com', 'github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'npmjs.com',
  'mozilla.org', 'adobe.com', 'paypal.com', 'stripe.com', 'shopify.com', 'myshopify.com', 'wix.com', 'wixsite.com',
  'squarespace.com', 'godaddy.com', 'bit.ly', 'tinyurl.com', 'addthis.com', 'sharethis.com', 'disqus.com',
  'hubspot.com', 'mailchimp.com', 'list-manage.com', 'zoom.us', 'dropbox.com', 'box.com', 'spotify.com', 'soundcloud.com',
  'apache.org', 'php.net', 'python.org', 'opensource.org', 'gnu.org', 'statcounter.com', 'histats.com', 'yandex.ru',
  'vk.com', 'baidu.com', 'qq.com', 'weibo.com', 'line.me', 'naver.com',
]
