
var handlebars = require('handlebars')
,JSZip = require('jszip')
,fs = require("fs")
,_ = require("lodash")
,static = require('node-static')
;

//create a static server to serve out the samples 

var fileServer = new static.Server('.'); 
require('http').createServer(function (request, response) {
    request.addListener('end', function () {
        fileServer.serve(request, response);
    }).resume();
}).listen(8080);

var rp = require('request-promise').defaults({ 
	//jar: true 
	//, simple: false
	//, resolveWithFullResponse: true
	// followAllRedirects: false
	// , followRedirect: false
}); 
    
var urlBase = 'http://localhost:8080/';
var data = {};
var templates = {};

handlebars.registerHelper("replaceVbarWithNewline", function(text) {
    return new handlebars.SafeString(text);    //.replace(/\|/gi,"\n")
});
handlebars.registerHelper("replaceBRwithVbar", function(text) {
    if (text && text.replace){
        return text.replace(/<br \/>/gi,'|');    //.replace(/\|/gi,"\n")
    } else {
        return text;
    }
});
handlebars.registerHelper("replaceBRwithNewLine", function(text) {
    var t=  text.replace(/<br \/>/gi,'\n');    //.replace(/\|/gi,"\n")
    return new handlebars.SafeString(t); 
});


var setData = function(base,key){
    return function(data){
        base[key] = data;
    };
};
var setTemplate = function(spec){
    return function(data){
        templates[spec.name]  =handlebars.compile(data);
    };
};
var setPartial = function(spec){
    return function(data){
        handlebars.registerPartial(spec.name, handlebars.compile(data));
    };
};

var rpFileCache = {}; //keep a local copy in memory of files downloaded to save repeating downloads
var getFileContent = function(spec,item){
    if (spec.url){
        if (!rpFileCache[spec.url]){
            rpFileCache[spec.url] = rp({
                uri:spec.url
                ,encoding:spec.encoding || null
                ,transform: function (body){
                    spec.content = body;
                    return spec;
                }
            });
        }    
        return rpFileCache[spec.url];      
    } else if(spec.content){
        return Promise.resolve(spec);
    } else if(spec.template){
        var mergedData = _.merge({},item,spec.extraData);
        if (spec.filter){     //allow filtering of data
            mergedData = spec.filter(mergedData);
        }
        return Promise.resolve({
            content: templates[spec.template](mergedData)
            ,filename: spec.filename(item)
            ,folder: spec.folder
        
        });
    }
};

// retrieve the data
Promise.all([
    rp({
        //uri:urlBase + 'testdata/users.json'
        uri:'testdata/users.json'
        ,json:true 
        ,transform: setData(data,'users')
    })
    ,rp({
        uri:urlBase + 'testdata/companies.json'
        ,json:true
        ,transform:setData(data,'companies')
    }) 
    ,rp({
        uri:urlBase + 'testdata/holidays.json'
        ,json:true
        ,transform: setData(data,'holidays')
    })
    ,rp({
        uri:urlBase + 'testdata/offices.json'
        ,json:true
        ,transform:setData(data,'offices')
    })   
    ,rp({
        uri:urlBase + 'templates/test.hbs'
        //,json:true
        ,transform:setTemplate({name:'test'})
    })
    ,rp({  uri:urlBase + 'templates/fps2_txt.hbs' ,transform:setTemplate({name:'fps2_txt'})    })    
    ,rp({  uri:urlBase + 'templates/_fps2icons_txt.hbs', transform:setPartial({name:'fps2icons_txt'})  })

]).then(function(ret){    //transform the data. ret here can be ignored
      
    //set a reference to the appropriate subsets 
    data.users.forEach(user => {
        //user.user = user;
        user.companydata = data.companies[user.company];
        user.officedata = _.merge({},{name:user.physicaldeliveryofficename},data.offices[user.physicaldeliveryofficename]);
        user.holidays = data.holidays.filter(function(row){
            return row.coemail == user.mail;     // filter holidays by email
        });
    });
    return data;
})
.then(function(data){    // get files based on each item. 

    // function to get array of items (i.e. how do we iterate through the data?)
    var items = (function(data){
        return data.users; 
        /*[data.users[0],data.users[2]] */
    })(data);
    
    // given an item, get the file specs
    var getFiles = function(item){
        //console.log("items:",item);
        return [
            {
                template: 'test'
                ,filename:function(item){return item.samaccountname + '_auto.htm';}
                ,datafilter: function(d){return d;}
                ,extraData: {
                    sections:{test:true}
                }
            }
            ,{
                template: 'test'
                ,filename: function(item){return item.samaccountname + '_auto_reply.htm';}
                ,datafilter: function(d){return d;}
                ,extraData: {
                    sections:{test:false}
                    ,cn:'Stanford Test'
                }
            }
            ,{
                template: 'fps2_txt'
                ,filename:function(item){return item.samaccountname + '_auto.txt';}
                ,extraData: {sections:{test:false}, cn:'Stanford Test'}
            }            
            ,{
                template: 'fps2_txt'
                ,filename:function(item){return item.samaccountname + '_auto_sal.txt';}
                ,extraData: {sections:{salutation:true}, Name:'Stanford Test'}
            }
            //{url: 'http://www.mybpos.net/wp-content/themes/mybpos-theme/img/logo.jpg',filename:'mybpos.jpg'}
            ,{url: 'http://server.com/MyBPOS.jpg',filename:'mybpos.jpg',folder:'images'}
            ,{url: 'http://server.com/3cxSilverPartner.png',filename:'3cxSilverPartner.png',folder:'images/a/b'}
            ,{content: 'echo hello',filename:'hello.bat'}
            ,{content: JSON.stringify(item, null, 2),filename:'data.json'}
        ];
    };

    //create the filename based on an item
    var zipFileName = function(item){return 'Sig_' + item.cn.replace(/[^a-z0-9]+/gi,'_');}
        
    return Promise.all(
        items.map(function(item){
            var zip = new JSZip();     //container for files
            item = (function(d){return d;})(item);
            return Promise.all(
                getFiles(item).map(function(fileSpec){
                    var fileContent = getFileContent(fileSpec,item);
                    //console.log(fileSpec,fileContent);
                   return fileContent.then(function(file){
                        zip.folder(file.folder).file(file.filename, file.content); 
                   });
                })
            ).then(function(files){
                var filepath = 'output/' + zipFileName(item) + '.zip';               
                return new Promise (function(resolve,reject){ 
                    fs.writeFile(filepath, zip.generate({type:"nodebuffer"}), function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(filepath);
                        }
                    });
                });                 
            });            
        })  
    );
    
}).then(function(files){
    console.log("wrote all files... ", files);
}).catch(function(err){
    console.log("ERROR",err.stack)
});


