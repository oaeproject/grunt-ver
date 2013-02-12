/*
Copyright (c) 2012 Chris Danford
Licensed under the MIT license.
*/

var fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  util = require('util');

module.exports = function(grunt) {
  grunt.registerMultiTask('ver', 'Add hashes to file names and update references to renamed files', function() {
    grunt.helper('ver', this.data.phases, this.data.version, this.data.forceVersion, this.data.basedir);
  });

  // Expose as a helper for possible consumption by other tasks.
  grunt.registerHelper('ver', function(phases, versionFilePath, forceVersion, basedir) {
    grunt.verbose.or.writeln('Run with --verbose for details.');
    var versions = {},  // map from original file name to version info
      simpleVersions = {};

    phases.forEach(function(phase) {
      var files = phase.files,
        references = phase.references,
        numFilesRenamed = 0;

      grunt.log.writeln('Versioning files.').writeflags(files);
      grunt.file.expandFiles(files).sort().forEach(function(f) {
        var version = forceVersion || grunt.helper('hash', f).slice(0, 8),
          basename = path.basename(f),
          parts = basename.split('.'),
          renamedBasename,
          renamedPath;

        // inject the version just before the file extension
        parts.splice(parts.length-1, 0, version);

        renamedBasename = parts.join('.');
        renamedPath = path.join(path.dirname(f), renamedBasename);

        fs.renameSync(f, renamedPath);
        grunt.verbose.write(f + ' ').ok(renamedBasename);

        versions[f] = {
          basename: basename,
          version: version,
          renamedBasename: renamedBasename,
          renamedPath: renamedPath
        };
        simpleVersions[f] = renamedPath;

        numFilesRenamed++;
      });
      grunt.log.write('Renamed ' + numFilesRenamed + ' files ').ok();

      if (references) {
        var totalReferences = 0;
        var totalReferencingFiles = 0;
        grunt.log.writeln('Replacing references.').writeflags(references);
        grunt.file.expandFiles(references).sort().forEach(function(f) {
          var content = grunt.file.read(f).toString(),
            replacedToCount = {},
            replacedKeys;

          Object.keys(versions).forEach(function(key) {
            var to = versions[key];
            var pathObj = _parsePathObj(to, basedir);

            // Replace all instances of paths from the base directory
            var escapedBase = pathObj.source.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
            var regex = new RegExp('\\b' + escapedBase + '\\b', 'g');
            content = content.replace(regex, function(match) {
              if (match in replacedToCount) {
                replacedToCount[match]++;
              } else {
                replacedToCount[match] = 1;
              }
              return pathObj.dest;
            });

          });

          replacedKeys = Object.keys(replacedToCount);
          if (replacedKeys.length > 0) {
            grunt.file.write(f, content);
            grunt.verbose.write(f + ' ').ok('replaced: ' + replacedKeys.join(', '));
            totalReferences++;
          }
          totalReferencingFiles++;
        });
        grunt.log.write('Replaced ' + totalReferences + ' in ' + totalReferencingFiles + ' files ').ok();
      }
    });

    if (versionFilePath) {
      grunt.log.writeln('Writing version file.');
      grunt.file.write(versionFilePath, JSON.stringify(simpleVersions, null, ' '));
      grunt.log.write(versionFilePath + ' ').ok();
    }
  });


  // This helper is a basic wrapper around crypto.createHash.
  grunt.registerHelper('hash', function(filePath, algorithm, encoding) {
    algorithm = algorithm || 'md5';
    encoding = encoding || 'hex';
    var hash = crypto.createHash(algorithm);

    grunt.log.verbose.writeln('Hashing ' + filePath + '.');
    hash.update(grunt.file.read(filePath));
    return hash.digest(encoding);
  });

  /**
   * Parse a version into an object that represents the source and destination of the inline path replacement.
   */
  var _parsePathObj = function(version, basedir) {

    // basedir = '/target/optimized/node_modules/oae-core/sharecontent/'
    basedir = util.format('/%s/', basedir).replace(/\/\//g, '/');

    // relativePath = js/sharecontent.bdc939b6.js
    var relativePath = version.renamedPath.replace(basedir.slice(1), '');

    // lastPart = sharecontent
    var lastPart = relativePath.split('/').pop().split('.').slice(0, -2).join('.');

    // sourceNoExt = js/sharecontent
    var sourceNoExt = null;
    if (relativePath.indexOf('/') !== -1) {
      // This was a root file, so no need to force a slash in between, or use the relative path at all
      sourceNoExt = relativePath.split('/').slice(0, -1).join('/') + '/' + lastPart;
    } else {
      sourceNoExt = lastPart;
    }
    
    // sourceWithExt = js/sharecontent.js
    var sourceWithExt = util.format('%s.%s', sourceNoExt, relativePath.split('.').pop());

    // destWithExt = js/sharecontent.bdc939b6.js
    var destWithExt = relativePath;

    return {'source': sourceWithExt, 'dest': destWithExt};

  };

};
