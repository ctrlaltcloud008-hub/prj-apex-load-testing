TARGET := ""

upload-ramp TARGET:
  k6 run services/upload/scenarios/ramp.js -e TARGET={{TARGET}}

upload-spike TARGET:
  k6 run services/upload/scenarios/spike.js -e TARGET={{TARGET}}

upload-sustained TARGET:
  k6 run services/upload/scenarios/sustained.js -e TARGET={{TARGET}}

upload-iterations TARGET VUS ITERATIONS:
  k6 run services/upload/scenarios/iterations.js -e TARGET={{TARGET}} -e VUS={{VUS}} -e ITERATIONS={{ITERATIONS}}

upload-all TARGET:
  k6 run services/upload/scenarios/ramp.js -e TARGET={{TARGET}}
  k6 run services/upload/scenarios/spike.js -e TARGET={{TARGET}}
  k6 run services/upload/scenarios/sustained.js -e TARGET={{TARGET}}
