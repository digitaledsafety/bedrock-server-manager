import re
content = open('test/pack_processing.test.js', 'r').read()
content = content.replace("expect.stringContaining('malicious.js')", "expect.stringContaining('malicious.js')")
# Wait, I want to see what is actually happening.
# I'll add some console.log to the backend.
