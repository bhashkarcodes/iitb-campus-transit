# Publishing the map

The project is static files, so any static host works and all of them are free at this size. GitHub Pages is the natural choice because the code already lives in the repository.

## GitHub Pages

1. Push the repository to GitHub.  
2. Open the repository, go to **Settings**, then **Pages** in the left sidebar.  
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`.  
4. Set the branch to `main` and the folder to `/ (root)`. Click **Save**.  
5. Wait about a minute, then reload the Pages settings screen. The URL appears at the top: `https://USERNAME.github.io/iitb-campus-transit/`.  
6. Put that URL in the README, in the repository's **About** panel on the right of the main page, and anywhere you are sharing the project.

Every push to `main` republishes within a minute or so. If a change does not appear, check the **Actions** tab for the `pages build and deployment` run, and hard-reload the page with Ctrl+Shift+R or Cmd+Shift+R to get past the browser cache.

### Common problems

| Symptom | Cause |
| :---- | :---- |
| Blank page, 404 on `css/styles.css` | Paths must be relative. `href="css/styles.css"`, never `href="/css/styles.css"` |
| Map area is grey | Tiles blocked or no internet. The page itself loads fine offline, the tiles do not |
| Page loads but nothing moves | JavaScript blocked, or `js/campus-data.js` failed. Open the console with F12 |
| 404 on the whole site | Pages needs a minute on first publish, and the repository must be public unless you have a paid plan |

## Netlify, if you prefer

Netlify gives you a nicer domain and deploy previews for pull requests.

1. Sign in at netlify.com with your GitHub account.  
2. **Add new site**, then **Import an existing project**, then pick the repository.  
3. Leave the build command empty and set the publish directory to `.` — there is nothing to build.  
4. **Deploy**. You get a URL like `iitb-transit.netlify.app`, which you can rename under **Site configuration**, then **Change site name**.

Vercel works the same way. Choose "Other" as the framework preset and leave the build settings empty.

## A custom domain

If you have a domain, add a file named `CNAME` at the root of the repository containing just the domain, then point a CNAME record at `USERNAME.github.io`. GitHub issues the HTTPS certificate automatically, which usually takes under an hour.