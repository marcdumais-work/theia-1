// prints each dev-dependency defined in one or more package.json
// given as input
//
// usage: find . -name package.json -exec node dev-deps.js {} \; 

var files = process.argv.slice(2);

for (i = 0; i < files.length; i++) {
    let file = files[i]
    data = require(file)

    if (data.devDependencies) {
        for (var key in data.devDependencies) {
            console.log(`"${key}" , ${data.devDependencies[key]}                 # from:  ${file}`)
        }
    }
}


