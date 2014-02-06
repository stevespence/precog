
  // A recogniser that eats up a stream of numbers and tries to predict
  // the next number in the stream. If it settles down into reliably predicting the stream
  // then it should shout if something out of the ordinary happens.

  // The numbers are held in a signal_buffer. The signal_buffer has a size limit
  // which determines how far back in time to look for patterns.
  // When a new number comes in it is pushed onto the signal_buffer, the the
  // oldest number is discarded. That sequence is then mapped onto a sequence trie,
  // the signal_history. The leaf terminating the sequence in the trie has a count which is
  // updated.
  // The signal_buffer sequence omitting the oldest number than then be
  // traced in the signal_history. The leaf with the higest count hanging
  // from that sequence is the prediction for the next number.
  // When the next number comes in, we record the accuracy of the prediction
  // in the prediction_history.
  // When the prediction_history is mostly positive then we can consider
  // alerting for incoming numbers wildly different. 

  // We could do various filtering to the input stream to aid recognition:
  // - Bucket the numbers like x % 10.
  // - Average three numbers together.
  // - Map the numbers to binary.
  // - Only consider if the number rises, falls or stays the same.
  // - Or consider size of increment/decrement.
  // - Change the sample interval for the numbers.

  // Treat everything as stream processing, so create averages, do bucketing etc on the run.

  // Reactive: imagine starting to bucket numbers based on history. If the recognizer
  // has seen lots of numbers and the number of repeats is very low then that
  // would be a sign to start bucketing.

  // 'Happiness' will be accurate predictions with a diverse range of input. Could
  // buck everything to 1 and prediction will be perfect but its of no value.

  ///////////////////////////////////////////////////////////////////////////////////
  // This filter is intended to reduce the number of numbers for a precog to monitor.
  // Instead of passing on each input number, this filter only emits a number once
  // every num_to_avg_over times, that number being the average of the inputs since the
  // last emit.
  AvgFilter = function(num_to_avg_over) {
    this.avg_over = num_to_avg_over;
    this.input_count = 0;
    this.mod_count = 0;
    this.running_avg = 0;
  }

  AvgFilter.prototype.accept = function(input) {
    this.input_count++;
    this.mod_count++;

    if (this.mod_count == 1) {
      this.running_avg = input; 
    } else {
      this.running_avg = (input + ((this.mod_count - 1) * this.running_avg)) / this.mod_count;
    }

    console.log('running average ' + this.running_avg);

    if (this.mod_count == this.avg_over) this.mod_count = 0;
  }

  AvgFilter.prototype.readyToEmit = function() {
    return (this.input_count > 0 && this.mod_count == 0);
  }

  AvgFilter.prototype.emit = function() {
    return this.running_avg;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // This filter buckets input to reduce the variability of input so that a precog
  // has a better chance of seeing the same sequences. 
  BucketFilter = function(granularity) {
    this.gran = granularity;
    this.bucket_value = 0;
  }

  BucketFilter.prototype.accept = function(input) {
    var diff = input % this.gran;
    this.bucket_value = input - diff;
    if (diff > (this.gran / 2)) {
      this.bucket_value = this.bucket_value + this.gran;
    }
  }

  BucketFilter.prototype.readyToEmit = function() {
    return true;
  }

  BucketFilter.prototype.emit = function() {
    return this.bucket_value;
  }

  //////////////////////////////////////////////////////////////////////

  function sequenceString(start_node) {
    var seq_str = '';
    for (var node = start_node; node.newer != null; node = node.newer) {
      seq_str += node.value;
      seq_str += ',';
    }
    seq_str += node.value;
    return seq_str;
  }

  ////////////////////////////////////////////////////////////////////////
  // A signal buffer holds a list of the last inputs. The size of the list
  // is set by the length param.
  SignalBuffer = function(length) {
    this.max_len = length;
    this.len = 0;
    this.oldest = null;
    this.newest = null;
  }

  SignalBuffer.prototype.push = function(signal_value) {
    var new_node = new Object();
    new_node.value = signal_value;
    new_node.newer = null;
    var old_newest = this.newest;
    this.newest = new_node;
    new_node.older = old_newest;
    if (this.len == 0) {
      this.oldest = new_node;
    } else {
      old_newest.newer = new_node;
    }
    if (this.len < this.max_len) {
      this.len++;
    } else {
      this.oldest = this.oldest.newer;
      this.oldest.older = null;
    }
    console.log('Signal buffer: ' + this.str());
  }

  SignalBuffer.prototype.str = function() {
    return sequenceString(this.oldest);
  }

  SignalBuffer.prototype.ready = function() {
    return (this.len == this.max_len);
  }

  ////////////////////////////////////////////////////////////
  // SignalStats describes the distribution of signal values.
  SignalStats = function() {
    this.num_values = 0;
    this.lowest_value = 0;
    this.highest_value = 0; 
    this.uniques = new Object();
  }

  SignalStats.prototype.newValue = function(value) {
    this.num_values++;
    if (this.num_values == 1 || value > this.highest_value) {
      this.highest_value = value;
    }
    if (this.num_values == 1 || value < this.lowest_value) {
      this.lowest_value = value;
    }
    if (!this.uniques[value]) {
      this.uniques[value] = 1;
    } else {
      this.uniques[value]++;
    }
  }

  SignalStats.prototype.summarise = function() {
    // Richness - the count of the number of different values that we have seen.
    // If the ratio of richness to num_values was anywhere close to 1 that would be a signal to
    // start bucketing. 
    console.log ('Signal stats - richness ' + Object.keys(this.uniques).length + '/' + this.num_values);
    console.log ('Signal stats - max ' + this.highest_value + ' min ' + this.lowest_value);

    // Todo: could calculate average unique count and std dev of those counts to indicate
    // how diverse the signal values are.
  }

  //////////////////////////////////////////////////////////////////
  // PredictionStats describes the variability of prediction success.
  PredictionStats = function() {
    this.num_correct = 0;
    this.num_incorrect = 0;
    this.no_prediction = 0;

// We want to store the list of sequences for which we made a correct prediction.
// The greater the number of unique sequences the better (weight this against number of non-correct predictions).
// Equally we would like some measure of how close we were for predictions which missed - would the second place
// prediction have been correct?
// If we are getting a lot of no_predictions then we should do something to simplify the input - add a filter
// or maybe shorten the signal history.
// If the num_correct / num_incorrect / no_prediction settle down into a steady state
// then we have a bunch of tweaks to make based on the ratios.
  }

  PredictionStats.prototype.checkPrediction = function(new_value, predicted_value, p_str) {
// todo: store p_str in a map with a count if the prediction works
    if (predicted_value == null) {
      this.no_prediction++;
    } else if (predicted_value == new_value) {
      this.num_correct++;
    } else {
      this.num_incorrect++;
    }
    console.log('Prediction stats: correct ' + this.num_correct + ' incorrect ' + this.num_incorrect + ' no prediction ' + this.no_prediction); 
  }

  ////////////////////////////////////////////////////////////////////////////
  // Signal history is a trie of signal input sequences. The higher levels
  // of the trie hold the older values in the sequences. The leaves at the
  // bottom hold a count for how many times that sequence has been encountered.
  SignalHistory = function() {
    this.root = new Object();
    this.prediction = null;  // null value interpreted as no_prediction
    this.p_rel_conf = 0;
    this.p_seq_str = null; // string version of the sequence for which we made a prediction
  }

  SignalHistory.prototype.setPrediction = function(value, conf, str) {
    this.prediction = value;
    this.p_rel_conf = conf;
    this.p_seq_str = str;
  }

  // A prediction is for the next value that will be pushed to the signal buffer.
  // The prediction is for the leaf with the highest count hanging off the end
  // of the last node in the trie.
  // A prediction has a relative confidence and a weighted confidence.
  // The relative confidence measures how many prediction options there were
  // and the relative counts on each.
  // The weighted confidence takes into account the number of times the
  // sequence has been seen. If we have only ever seen a sequence once then
  // we would have 100% relative confidence but low weighted confidence.
  // The sequence pass as the param will be one node shorted than the signal
  // buffer.
  SignalHistory.prototype.predict = function(sequence) {
    var seq_node = sequence;
    var trie_node = this.root;
    while(true) {
      if (!trie_node[seq_node.value]) {
        this.setPrediction(null, 0, sequenceString(sequence));
        console.log('No prediction for ' + this.p_seq_str);
        break;
      }
      trie_node = trie_node[seq_node.value];
      if (!seq_node.newer) {
        // look at child nodes of trie_node for prediction.
        var count_total = 0;
        var highest_count = 0;
        var pick = null;
        for (var key in trie_node) {
          var count = trie_node[key].s_count;
          if (count != undefined) { 
            count_total = count_total + count;
            if (count > highest_count) {
              highest_count = count;
              pick = key;
            }
          }
        }
        this.setPrediction(pick, highest_count / count_total, sequenceString(sequence)); 
        console.log('Predict ' + this.prediction + ' with rel conf ' + this.p_rel_conf + ' for ' + this.p_seq_str);
        break;
      }
      seq_node = seq_node.newer; 
    }
  }

  // The sequence param is the oldest node in the signal buffer.
  SignalHistory.prototype.addSequence = function(sequence) {
    var seq_node = sequence;
    var trie_node = this.root;
    while(true) {
      if (!trie_node[seq_node.value]) {
        trie_node[seq_node.value] = new Object();
        trie_node[seq_node.value].s_count = 0;
      }
      trie_node = trie_node[seq_node.value];
      if (!seq_node.newer) { // reached a leaf
        trie_node.s_count++;
        console.log('sequence has been seen ' + trie_node.s_count + ' times');
        break;
      }
      seq_node = seq_node.newer;
    }
    // make prediction
    this.predict(sequence.newer);
  }

  //////////////////////////////////////////////////////////
  Precog = function() {
    this.signal_history = new SignalHistory();
    this.signal_buffer = new SignalBuffer(3);
    this.raw_signal_stats = new SignalStats();
    this.filtered_signal_stats = new SignalStats();
    this.prediction_stats = new PredictionStats();
    this.filters = new Array();
    this.filters.push(new BucketFilter(10));
  }

// todo: we want to describe the precog with a config that encapsulates
// all the params, like the length of the signal buffer and the filter values

// todo: We want the prediction
// stats to lead to trying different  types of filter to get to prediction happiness.
// Prediction happiness also needs defined - could filter everything to 1 and then predict
// it perfectly but thats kind of boring rather than happy
// so a function that takes the precog config, the signal stats and the prediction
// stats and potentially mods the config to reach 'better predictions'

// todo: Once we have the stats driving the config in a certain direction we want to introduce
// a bit of jitter into the system to provide for escaping local maxima.

  Precog.prototype.newSignalValue = function(signal_value) {
    console.log('New raw signal value: ' + signal_value);

    var filtered_value = signal_value;
    for (var i = 0; i < this.filters.length; i++) {
      var filter = this.filters[i];
      filter.accept(filtered_value);
      if (!filter.readyToEmit()) {
        return;
      }
      filtered_value = filter.emit();
    }

    console.log('Processing filtered signal value: ' + filtered_value);

    this.filtered_signal_stats.newValue(filtered_value);
    this.prediction_stats.checkPrediction(filtered_value, this.signal_history.prediction, this.signal_history.p_seq_str);
    this.signal_buffer.push(filtered_value);
    if (this.signal_buffer.ready()) {
      this.signal_history.addSequence(this.signal_buffer.oldest);  
    }
  }

